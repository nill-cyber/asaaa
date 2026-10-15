import { db } from "./firebase";
import { ServerValue } from "firebase-admin/database";
import { HttpError, TgUser } from "./auth";
import { getSettings, Settings } from "./settings";
import { dayKey } from "./log";
import { earn, activity, lbAdd } from "./wallet";

export const MAX_BATCH_LIMIT = 50; // এক request-এ সর্বোচ্চ tap
export const MAX_TAPS_PER_SEC = 15; // সর্বোচ্চ tap/sec
export const MAX_AUTH_AGE_MONEY = 3600; // টাকা-সংক্রান্ত endpoint-এ initData ১ ঘণ্টা
export const MAX_FAILED_ATTEMPTS = 3;
export const VISIT_TOKEN_TTL_MS = 15 * 60 * 1000;

export interface Boost {
  name: string;
  bought_at: number;
  expires_at: number; // 0 = স্থায়ী
  tap: number; // প্রতি tap-এ বাড়তি unit
  en: number; // বাড়তি max energy
  regen: number; // বাড়তি energy/sec
  mph: number; // auto-mining unit/ঘণ্টা
  starts_at?: number; // পরে শুরু হলে (downgrade)
  price?: number; // প্ল্যানের পূর্ণ দাম (র‍্যাঙ্কের জন্য)
  paid?: number; // আসলে যত দিয়েছে (upgrade-এ কম)
}
export interface Stake {
  plan_id: string;
  name: string;
  amount: number;
  reward: number;
  start: number;
  end: number;
  status: "active" | "claimed";
}

export const boostActive = (b: Boost, now = Date.now()) => (b.starts_at || 0) <= now && (b.expires_at === 0 || b.expires_at > now);
export const boostQueued = (b: Boost, now = Date.now()) => (b.starts_at || 0) > now;

export type BoostKind = "buy" | "upgrade" | "downgrade" | "current" | "queued" | "blocked";
export interface BoostQuote { kind: BoostKind; cost: number; startsAt: number; activeIds: string[]; queuedIds: string[]; queuedRefund: number }

/**
 * একসাথে একটাই boost। বেশি দামি = upgrade (বর্তমানটার বাকি মেয়াদের আনুপাতিক মূল্য কেটে যায়, এখনই শুরু)।
 * কম দামি = downgrade (পুরো দাম দিয়ে, বর্তমানটা শেষ হলে শুরু; আগে থেকে queue থাকলে বা বর্তমানটা স্থায়ী হলে নয়)।
 */
export function quoteBoost(boosts: Record<string, Boost> | undefined, plan: { id: string; price: number; duration_days: number }, now = Date.now()): BoostQuote {
  const all = Object.entries(boosts || {});
  const active = all.filter(([, b]) => boostActive(b, now));
  const queued = all.filter(([, b]) => boostQueued(b, now) && (b.expires_at === 0 || b.expires_at > now));
  const q: BoostQuote = { kind: "buy", cost: plan.price, startsAt: now, activeIds: active.map(([i]) => i), queuedIds: queued.map(([i]) => i), queuedRefund: 0 };
  if (active.some(([i]) => i === plan.id)) return { ...q, kind: "current", cost: 0 };
  if (queued.some(([i]) => i === plan.id)) return { ...q, kind: "queued", cost: 0, startsAt: queued.find(([i]) => i === plan.id)![1].starts_at || now };
  if (!active.length) return q;
  const top = Math.max(...active.map(([, b]) => b.price ?? b.paid ?? 0));
  if (plan.price > top) {
    let credit = 0;
    for (const [, b] of active) {
      const paid = b.paid ?? b.price ?? 0;
      if (b.expires_at === 0) continue; // স্থায়ী প্ল্যানের আনুপাতিক মান নেই
      const from = b.starts_at || b.bought_at;
      const total = Math.max(1, b.expires_at - from);
      credit += Math.floor((paid * Math.max(0, b.expires_at - now)) / total);
    }
    return { ...q, kind: "upgrade", cost: Math.max(0, plan.price - credit), queuedRefund: queued.reduce((a, [, b]) => a + (b.paid ?? b.price ?? 0), 0) };
  }
  if (queued.length || active.some(([, b]) => b.expires_at === 0)) return { ...q, kind: "blocked", cost: 0 };
  return { ...q, kind: "downgrade", startsAt: Math.max(...active.map(([, b]) => b.expires_at)) };
}

/** জমে থাকা auto-mining (সর্বোচ্চ capHours ঘণ্টা); cur.balance-এ যোগ করে, mine_at = now */
export function settleMining(cur: UserRecord, capHours: number, now = Date.now()): number {
  let total = 0;
  const from = Math.max(cur.mine_at || 0, now - capHours * 3600000);
  for (const b of Object.values(cur.boosts || {})) {
    if (!b.mph) continue;
    const start = Math.max(from, b.starts_at || b.bought_at);
    const end = b.expires_at === 0 ? now : Math.min(now, b.expires_at);
    if (end > start) total += (b.mph * (end - start)) / 3600000;
  }
  const amt = Math.floor(total);
  cur.balance += amt;
  earn(cur, "mining", amt);
  cur.mine_at = now;
  return amt;
}

export function pendingMining(cur: UserRecord, capHours: number, now = Date.now()): { amount: number; perHour: number } {
  const copy = { ...cur, balance: 0, earn: undefined } as UserRecord;
  const amount = settleMining(copy, capHours, now);
  let perHour = 0;
  for (const b of Object.values(cur.boosts || {})) if (boostActive(b, now)) perHour += b.mph || 0;
  return { amount, perHour };
}

export interface UserRecord {
  name?: string;
  username?: string;
  created_at?: number;
  last_seen?: number;
  earn?: Record<string, number>;
  spent?: Record<string, number>;
  usdt_tot?: Record<string, number>;
  usdt_u?: number; // USDT ব্যালেন্স, micro-USDT (১ USDT = 1,000,000) — float ভুল এড়াতে
  trade_day?: { day: string; u: number };
  boosts?: Record<string, Boost>;
  mine_at?: number;
  stakes?: Record<string, Stake>;
  daily?: { day: string; streak: number };
  referred_by?: string;
  ref_paid?: boolean;
  ref_count?: number;
  ref_earned?: number;
  onboarded?: boolean;
  ref_comm?: number; // এর মধ্যে কমিশন
  ref_comm_at?: number;
  banned?: boolean;
  ban_reason?: string;
  balance: number;
  energy: number;
  max_energy: number;
  energy_regen_rate: number;
  spin?: { day: string; used: number; extra: number };
  ads?: { day: string; coins: number; energy: number; spin: number; nonce?: string; ns?: number; p?: string; srv?: number };
  promos?: Record<string, number>;
  notify_off?: boolean;
  ord_open?: number;
  orders?: Record<string, any>;
  alerts?: Record<string, any>;
  empty_at?: number | null; // energy শেষ যখন খালি হয়েছিল
  earn_per_tap: number;
  last_energy_calc_time: number;
  last_tap_time: number;
  completed_tasks?: Record<string, { claimed?: boolean; claimed_at: number }>;
  pending_tasks?: Record<string, { started_at: number }>;
  active_codes?: Record<
    string,
    { code_hash: string; created_at: number; expires_at: number; failed_attempts: number }
  >;
  used_tokens?: Record<string, number>;
  active_run?: string;
  withdrawals?: Record<string, { amount: number; method: string; status: string; created_at: number }>;
}

export function newUser(now = Date.now()): UserRecord {
  return {
    balance: 0,
    energy: 1000,
    max_energy: 1000,
    energy_regen_rate: 3,
    earn_per_tap: 1,
    last_energy_calc_time: now,
    last_tap_time: 0,
  };
}

/** খালি হওয়ার refillHours ঘণ্টা পর পুরো ভরে; এর আগে শুধু (থাকলে) ধীর regen */
export function currentEnergy(u: UserRecord, now = Date.now(), refillHours = 0): number {
  if (refillHours > 0 && u.empty_at && now >= u.empty_at + refillHours * 3600000) return u.max_energy;
  const deltaSec = Math.max(0, (now - u.last_energy_calc_time) / 1000);
  return Math.min(u.max_energy, u.energy + deltaSec * u.energy_regen_rate);
}

/** settings-এর মান user-এর ওপর বসিয়ে "কার্যকর" মান (admin বদলালে সবার জন্য একসাথে বদলায়) */
export function effective(u: UserRecord, s: Settings, now = Date.now()): UserRecord {
  let tap = 0, en = 0, regen = 0;
  for (const b of Object.values(u.boosts || {})) {
    if (!boostActive(b, now)) continue;
    tap += b.tap || 0;
    en += b.en || 0;
    regen += b.regen || 0;
  }
  return { ...u, max_energy: s.max_energy + en, energy_regen_rate: s.energy_regen + regen, earn_per_tap: s.earn_per_tap + tap };
}

/**
 * প্রতি request-এ একবার: user না থাকলে তৈরি, ban / maintenance হলে আটকানো।
 * soft=true হলে আটকায় না (me endpoint নিজে দেখায়)। touch=true হলে নাম ও last_seen হালনাগাদ।
 */
export async function ensureUser(
  user: TgUser,
  opts: { soft?: boolean; touch?: boolean } = {}
): Promise<{ u: UserRecord; settings: Settings }> {
  const settings = await getSettings();
  const ref = db().ref(`users/${user.id}`);
  let u = (await ref.get()).val() as UserRecord | null;
  const now = Date.now();
  const name = String(user.first_name || "User").slice(0, 60);
  const username = user.username ? String(user.username).slice(0, 40) : "";

  if (u === null) {
    let referred_by: string | undefined;
    const m = /^ref_(\d{1,20})$/.exec(user.start_param || "");
    if (m && m[1] !== user.id && settings.referral_enabled && (await db().ref(`users/${m[1]}/balance`).get()).val() !== null) referred_by = m[1];
    const res = await ref.transaction((cur) =>
      cur === null ? { ...newUser(now), name, username, created_at: now, last_seen: now, ...(referred_by ? { referred_by } : {}) } : undefined
    );
    if (res.committed) {
      await db()
        .ref()
        .update({
          [`user_index/${user.id}`]: { name, username, created_at: now },
          "stats/users_total": ServerValue.increment(1),
          [`stats/new_users/${dayKey(now)}`]: ServerValue.increment(1),
        })
        .catch(() => {});
    }
    u = (await ref.get()).val() as UserRecord;
  } else if (opts.touch) {
    const upd: Record<string, any> = {};
    if (!u.created_at) upd[`users/${user.id}/created_at`] = now;
    if (u.name !== name || (u.username || "") !== username) {
      upd[`users/${user.id}/name`] = name;
      upd[`users/${user.id}/username`] = username;
      upd[`user_index/${user.id}`] = { name, username, created_at: u.created_at || now };
    }
    if (dayKey(u.last_seen || 0) !== dayKey(now)) upd[`stats/dau/${dayKey(now)}`] = ServerValue.increment(1);
    upd[`users/${user.id}/last_seen`] = now;
    await db().ref().update(upd).catch(() => {});
  }

  if (!opts.soft) {
    if (u!.banned) throw new HttpError(403, "account_banned");
    if (settings.maintenance) throw new HttpError(503, "maintenance");
  }
  return { u: u!, settings };
}

/** আমন্ত্রিত user প্রথম টাস্ক/আর্টিকেল শেষ করলে রেফারার ও নতুন user bonus পায় (একবারই) */
export async function qualifyReferral(uid: string) {
  try {
    const s = await getSettings();
    if (!s.referral_enabled) return;
    const u = (await db().ref(`users/${uid}`).get()).val() as UserRecord | null;
    if (!u?.referred_by || u.ref_paid || !Object.keys(u.completed_tasks || {}).length) return;
    let first = false;
    await db()
      .ref(`users/${uid}`)
      .transaction((cur: UserRecord | null) => {
        first = false;
        if (cur === null) return cur;
        if (cur.ref_paid || !cur.referred_by) return;
        cur.ref_paid = true;
        cur.balance += s.invitee_bonus;
        earn(cur, "referral", s.invitee_bonus);
        first = true;
        return cur;
      });
    if (!first) return;
    const refId = u.referred_by;
    let paid = 0;
    await db()
      .ref(`users/${refId}`)
      .transaction((cur: UserRecord | null) => {
        paid = 0;
        if (cur === null) return cur;
        if ((cur.ref_count || 0) >= s.referral_max) return;
        cur.balance += s.referrer_bonus;
        earn(cur, "referral", s.referrer_bonus);
        cur.ref_count = (cur.ref_count || 0) + 1;
        cur.ref_earned = (cur.ref_earned || 0) + s.referrer_bonus;
        paid = s.referrer_bonus;
        return cur;
      });
    await lbAdd(uid, s.invitee_bonus);
    await lbAdd(refId, paid);
    await activity(uid, "referral", { coins: s.invitee_bonus, note: "Welcome bonus" });
    if (paid) await activity(refId, "referral", { coins: paid, note: `${u.name || "A friend"} joined` });
    await db()
      .ref(`referrals/${refId}/${uid}`)
      .set({ name: u.name || "User", at: Date.now(), bonus: paid });
  } catch (e) {
    console.error("qualifyReferral failed", e);
  }
}

/** রেফারি-র "আয়" যা থেকে কমিশন হয়: tap, article, task, daily, mining, spin, ads। (stake, trade/কেনা, admin credit, promo, prize, referral নয়) */
const COMM_KEYS = ["tap", "articles", "tasks", "daily", "mining", "spin", "ads"] as const;
export const commissionBase = (earn?: Record<string, number>) => COMM_KEYS.reduce((a, k) => a + (Number(earn?.[k]) || 0), 0);

/**
 * রেফারার তার রেফারিদের আয়ের s.referral_commission_pct% পায় (রেফারির ব্যালেন্স কমে না)।
 * প্রতি রেফারির "আগে যা দেওয়া হয়েছে" একটা transaction-এ বাড়ানো হয় — দুই জায়গা থেকে একসাথে চললেও দুইবার পায় না।
 */
export async function settleCommission(refId: string, force = false): Promise<number> {
  try {
    const s = await getSettings();
    if (!s.referral_enabled || !(s.referral_commission_pct > 0)) return 0;
    const now = Date.now();
    const me = (await db().ref(`users/${refId}`).get()).val() as UserRecord | null;
    if (!me || me.banned) return 0;
    if (!force && now - (me.ref_comm_at || 0) < 10 * 60000) return 0;
    const list = ((await db().ref(`referrals/${refId}`).get()).val() || {}) as Record<string, any>;
    let total = 0;
    for (const uid of Object.keys(list).slice(0, Math.max(0, s.referral_max))) {
      const e = (await db().ref(`users/${uid}/earn`).get()).val() as Record<string, number> | null;
      const target = Math.floor((commissionBase(e || undefined) * s.referral_commission_pct) / 100);
      let prev = 0;
      const r = await db().ref(`referrals/${refId}/${uid}/comm`).transaction((cur: number | null) => {
        prev = cur || 0;
        return target > prev ? target : undefined;
      });
      if (r.committed && target > prev) total += target - prev;
    }
    await db().ref(`users/${refId}/ref_comm_at`).set(now);
    if (total <= 0) return 0;
    await db().ref(`users/${refId}`).transaction((cur: UserRecord | null) => {
      if (cur === null) return cur;
      cur.balance += total;
      earn(cur, "referral", total);
      cur.ref_earned = (cur.ref_earned || 0) + total;
      cur.ref_comm = (cur.ref_comm || 0) + total;
      return cur;
    });
    await activity(refId, "referral", { coins: total, note: `${s.referral_commission_pct}% friends' earnings` });
    return total;
  } catch (e) {
    console.error("settleCommission failed", e);
    return 0;
  }
}
