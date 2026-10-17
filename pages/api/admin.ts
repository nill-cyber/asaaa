import { requireAdmin, HttpError } from "@/lib/auth";
import { route } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ServerValue } from "firebase-admin/database";
import { ArticleSite, normUrl } from "@/lib/chain";
import { sortableId, randomToken } from "@/lib/crypto";
import { seal } from "@/lib/secretbox";
import { refundOrder } from "@/lib/shop";
import { adminLog, dayKey } from "@/lib/log";
import { getSettings, invalidateSettings, parseSettings } from "@/lib/settings";
import { tgCall, webhookSecret } from "@/lib/telegram";
import type { UserRecord } from "@/lib/user";
import { earn, usdtTot, activity } from "@/lib/wallet";
import { notify } from "@/lib/notify";
import { payWeek, top, names } from "@/lib/leaderboard";
import { weekIndex } from "@/lib/wallet";
import { processTriggers } from "@/lib/triggers";
import { getPrice, fromU, toU } from "@/lib/market";
import { settleDeposit, recheckAuto } from "@/lib/deposits";
import { checkKey, clearCreds, credHint, getCreds, saveCreds, recentDeposits, payReceived } from "@/lib/binance";

const idRe = /^[\w-]{1,64}$/;

function httpsUrl(v: any, field: string): string {
  const s = String(v || "").trim();
  if (!/^https:\/\/[^\s]+$/i.test(s)) throw new HttpError(400, `${field} must be an https URL`);
  return s;
}
function posInt(v: any, field: string, max = 1e9, min = 0): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `Invalid ${field}`);
  return n;
}

/** আর্টিকেল সাইটের ফর্ম যাচাই: ২–১০টা https URL, সব একই ডোমেইনের, কোনোটা দুইবার নয় */
function parseSite(b: any): ArticleSite {
  const raw: string[] = Array.isArray(b.urls) ? b.urls : String(b.urls || "").split(/\r?\n/);
  const urls = raw.map((s) => String(s).trim()).filter(Boolean);
  if (urls.length < 2 || urls.length > 10) throw new HttpError(400, "Enter 2 to 10 article URLs, one per line");
  const norms: string[] = [];
  for (const u of urls) {
    httpsUrl(u, "article url");
    const n = normUrl(u);
    if (!n) throw new HttpError(400, `Invalid URL: ${u}`);
    norms.push(n);
  }
  if (new Set(norms.map((n) => n.split("/")[0])).size !== 1) {
    throw new HttpError(400, "All articles must be on the same domain");
  }
  if (new Set(norms).size !== norms.length) throw new HttpError(400, "The same URL can't be used twice");
  const name = String(b.name || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60);
  if (!name) throw new HttpError(400, "Enter a site name");
  const dwell = posInt(b.dwell_seconds ?? 15, "dwell_seconds", 300, 5);
  const lock = posInt(b.lock_seconds ?? 5, "lock_seconds", 60, 0);
  if (lock >= dwell) throw new HttpError(400, "Top-read seconds must be less than seconds per article");
  return {
    name,
    urls,
    reward: posInt(b.reward, "reward", 1e7, 1),
    cooldown_minutes: posInt(b.cooldown_minutes, "cooldown_minutes", 60 * 24 * 30),
    dwell_seconds: dwell,
    lock_seconds: lock,
    is_active: b.is_active !== false,
  };
}

const norm = (s: any) => String(s || "").toLowerCase().replace(/\s+/g, "");
const clean = (v: any, n: number) => String(v || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

// ব্যালেন্সের মোট (liability) ও user_index ভারী — ৫ মিনিট/১ মিনিট cache
let liab: { at: number; total: number; usdt: number; locked: number; owed: number; users: number; top: any[] } | null = null;
async function liability() {
  if (liab && Date.now() - liab.at < 300000) return liab;
  const all = ((await db().ref("users").get()).val() || {}) as Record<string, UserRecord>;
  let total = 0;
  let usdt = 0;
  let locked = 0;
  let owed = 0;
  const arr: { id: string; name: string; balance: number }[] = [];
  for (const [id, u] of Object.entries(all)) {
    const bal = Number(u.balance) || 0;
    total += bal;
    usdt += Number(u.usdt_u) || 0;
    for (const k of Object.values(u.stakes || {})) if (k.status === "active") { locked += k.amount; owed += k.reward; }
    arr.push({ id, name: u.name || "", balance: bal });
  }
  arr.sort((a, b) => b.balance - a.balance);
  liab = { at: Date.now(), total, usdt, locked, owed, users: arr.length, top: arr.slice(0, 5) };
  return liab;
}
let idx: { at: number; v: Record<string, any> } | null = null;
async function userIndex() {
  if (idx && Date.now() - idx.at < 60000) return idx.v;
  const v = ((await db().ref("user_index").get()).val() || {}) as Record<string, any>;
  idx = { at: Date.now(), v };
  return v;
}

const recentWithdrawals = (n: number) => recent("withdrawals", n);
async function recent(path: string, n: number) {
  const snap = await db().ref(path).orderByKey().limitToLast(n).get();
  const out: any[] = [];
  snap.forEach((c) => {
    out.push({ id: c.key, ...c.val() });
  });
  return out.reverse(); // নতুন আগে
}

async function usdtStats(liabU: number) {
  const [dep, pay, vol, fees] = await Promise.all([
    recent("deposits", 300),
    recent("usdt_withdrawals", 300),
    db().ref("stats/trade_volume_u").get(),
    db().ref("stats/trade_fees_u").get(),
  ]);
  const pd = dep.filter((d) => d.status === "pending");
  const pp = pay.filter((d) => d.status === "pending");
  return {
    liability: fromU(liabU),
    pendingDeposits: { count: pd.length, amount: pd.reduce((a, d) => a + (Number(d.amount) || 0), 0) },
    pendingPayouts: { count: pp.length, amount: pp.reduce((a, d) => a + (Number(d.amount) || 0), 0) },
    volume: fromU(Number(vol.val()) || 0),
    fees: fromU(Number(fees.val()) || 0),
  };
}

/** সব admin কাজ এক endpoint-এ: body.action দিয়ে আলাদা */
export default route(async (req, res) => {
  const admin = requireAdmin(req);
  const who = admin.id;
  const b = req.body || {};
  const action = String(b.action || "");

  switch (action) {
    case "list": {
      const [s, t, st] = await Promise.all([
        db().ref("article_sites").get(),
        db().ref("tasks").get(),
        db().ref("stats/sites").get(),
      ]);
      const stats = (st.val() || {}) as Record<string, any>;
      const sites = Object.entries((s.val() || {}) as Record<string, any>).map(([id, v]) => ({
        id,
        ...v,
        stats: { started: 0, finished: 0, claimed: 0, ...(stats[id] || {}) },
      }));
      const tasks = Object.entries((t.val() || {}) as Record<string, any>).map(([id, v]) => ({ id, ...v }));
      const withdrawals = await recentWithdrawals(300);
      return void res.json({ success: true, sites, tasks, withdrawals });
    }

    case "stats": {
      const [base, dauSnap, newSnap, wds, L] = await Promise.all([
        db().ref("stats/users_total").get(),
        db().ref("stats/dau").orderByKey().limitToLast(7).get(),
        db().ref("stats/new_users").orderByKey().limitToLast(7).get(),
        recentWithdrawals(500),
        liability(),
      ]);
      const dau = (dauSnap.val() || {}) as Record<string, number>;
      const nu = (newSnap.val() || {}) as Record<string, number>;
      const days: { day: string; active: number; joined: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = dayKey(Date.now() - i * 86400000);
        days.push({ day: d, active: Number(dau[d]) || 0, joined: Number(nu[d]) || 0 });
      }
      const sum = (st: string) => wds.filter((w) => w.status === st);
      const amt = (a: any[]) => a.reduce((x, w) => x + (Number(w.amount) || 0), 0);
      const pending = sum("pending");
      const paid = sum("paid");
      return void res.json({
        success: true,
        usersTotal: Number(base.val()) || L.users,
        activeToday: days[6].active,
        joinedToday: days[6].joined,
        days,
        pending: { count: pending.length, amount: amt(pending) },
        paid: { count: paid.length, amount: amt(paid) },
        liability: { total: L.total, users: L.users, top: L.top, at: L.at },
        usdt: await usdtStats(L.usdt),
        staking: { locked: L.locked, owed: L.owed },
      });
    }

    case "users": {
      const q = clean(b.q, 60).toLowerCase();
      const index = await userIndex();
      let rows = Object.entries(index).map(([id, v]) => ({ id, name: v.name || "", username: v.username || "", created_at: v.created_at || 0 }));
      if (q) {
        rows = rows.filter((r) => r.id === q || r.name.toLowerCase().includes(q) || r.username.toLowerCase().includes(q.replace(/^@/, "")));
      }
      rows.sort((a, b) => b.created_at - a.created_at);
      rows = rows.slice(0, 30);
      const bal = await Promise.all(rows.map((r) => db().ref(`users/${r.id}`).get()));
      const out = rows.map((r, i) => {
        const u = (bal[i].val() || {}) as UserRecord;
        return { ...r, balance: Number(u.balance) || 0, banned: !!u.banned, last_seen: u.last_seen || 0 };
      });
      return void res.json({ success: true, users: out });
    }

    case "user": {
      const uid = String(b.uid || "").trim();
      if (!/^\d{1,20}$/.test(uid)) throw new HttpError(400, "Invalid user id");
      const [us, fl, wds] = await Promise.all([
        db().ref(`users/${uid}`).get(),
        db().ref(`flags/${uid}`).get(),
        db().ref(`users/${uid}/withdrawals`).get(),
      ]);
      const u = us.val() as UserRecord | null;
      if (!u) throw new HttpError(404, "User not found");
      const wl = Object.entries((wds.val() || {}) as Record<string, any>)
        .sort(([a], [b2]) => (a < b2 ? 1 : -1))
        .slice(0, 20)
        .map(([id, w]) => ({ id, ...w }));
      return void res.json({
        success: true,
        user: {
          id: uid,
          name: u.name || "",
          username: u.username || "",
          balance: Number(u.balance) || 0,
          usdt: fromU(u.usdt_u || 0),
          banned: !!u.banned,
          ban_reason: u.ban_reason || "",
          created_at: u.created_at || 0,
          last_seen: u.last_seen || 0,
          tasks_done: Object.keys(u.completed_tasks || {}).length,
          has_active_run: !!u.active_run,
        },
        flags: fl.val() || {},
        withdrawals: wl,
      });
    }

    case "adjustBalance": {
      const uid = String(b.uid || "").trim();
      if (!/^\d{1,20}$/.test(uid)) throw new HttpError(400, "Invalid user id");
      const delta = Math.trunc(Number(b.delta));
      if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1e9) throw new HttpError(400, "Invalid amount");
      const reason = clean(b.reason, 200);
      if (reason.length < 3) throw new HttpError(400, "A reason is required");
      let before = 0;
      let after = 0;
      let err = "";
      let missing = false;
      await db()
        .ref(`users/${uid}`)
        .transaction((cur: UserRecord | null) => {
          err = "";
          missing = cur === null;
          if (cur === null) return cur;
          before = Number(cur.balance) || 0;
          if (before + delta < 0) {
            err = "Balance can't go below zero";
            return;
          }
          cur.balance = before + delta;
          if (delta > 0) earn(cur, "adjust", delta);
          after = cur.balance;
          return cur;
        });
      if (missing) throw new HttpError(404, "User not found");
      if (err) throw new HttpError(409, err);
      await activity(uid, "adjust", { coins: delta, note: reason });
      await adminLog(who, "adjust_balance", { uid, delta, reason, before, after });
      liab = null;
      return void res.json({ success: true, balance: after });
    }

    case "banUser": {
      const uid = String(b.uid || "").trim();
      if (!/^\d{1,20}$/.test(uid)) throw new HttpError(400, "Invalid user id");
      const exists = (await db().ref(`users/${uid}/balance`).get()).val();
      if (exists === null) throw new HttpError(404, "User not found");
      const banned = !!b.banned;
      const reason = clean(b.reason, 200);
      await db().ref().update({ [`users/${uid}/banned`]: banned ? true : null, [`users/${uid}/ban_reason`]: banned ? reason : null });
      await adminLog(who, banned ? "ban" : "unban", { uid, reason });
      return void res.json({ success: true });
    }

    case "growthPlans": {
      const [bp, sp, pools] = await Promise.all([db().ref("boost_plans").get(), db().ref("stake_plans").get(), db().ref("stake_pools").get()]);
      const pl = (pools.val() || {}) as Record<string, number>;
      return void res.json({
        success: true,
        boosts: Object.entries((bp.val() || {}) as Record<string, any>).map(([id, v]) => ({ id, ...v })),
        stakes: Object.entries((sp.val() || {}) as Record<string, any>).map(([id, v]) => ({ id, ...v, pool_used: pl[id] || 0 })),
      });
    }

    case "saveBoost": {
      const name = clean(b.name, 40);
      if (!name) throw new HttpError(400, "Name required");
      const data = {
        name,
        price: posInt(b.price, "price", 1e12, 1),
        tap_bonus: posInt(b.tap_bonus ?? 0, "tap bonus", 100000),
        energy_bonus: posInt(b.energy_bonus ?? 0, "energy bonus", 1e6),
        regen_bonus: Math.min(1000, Math.max(0, Number(b.regen_bonus) || 0)),
        mine_per_hour: posInt(b.mine_per_hour ?? 0, "mining per hour", 1e9),
        duration_days: posInt(b.duration_days ?? 0, "duration", 3650),
        is_active: b.is_active !== false,
      };
      if (!data.tap_bonus && !data.energy_bonus && !data.regen_bonus && !data.mine_per_hour) throw new HttpError(400, "A boost needs at least one benefit");
      const id = b.id ? String(b.id) : db().ref("boost_plans").push().key!;
      if (!idRe.test(id)) throw new HttpError(400, "Invalid id");
      await db().ref(`boost_plans/${id}`).set(data);
      await adminLog(who, b.id ? "edit_boost" : "add_boost", { id, name });
      return void res.json({ success: true, id });
    }
    case "deleteBoost": {
      const id = String(b.id || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid id");
      await db().ref(`boost_plans/${id}`).remove();
      await adminLog(who, "delete_boost", { id });
      return void res.json({ success: true });
    }

    case "saveStakePlan": {
      const name = clean(b.name, 40);
      if (!name) throw new HttpError(400, "Name required");
      const pct = Number(b.reward_pct);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 1000) throw new HttpError(400, "Invalid reward %");
      const min = posInt(b.min, "min", 1e12, 1);
      const max = posInt(b.max, "max", 1e12, 1);
      if (max < min) throw new HttpError(400, "Max must be at least min");
      const data = { name, days: posInt(b.days, "days", 3650, 1), reward_pct: pct, min, max, pool_cap: posInt(b.pool_cap ?? 0, "pool cap", 1e13), is_active: b.is_active !== false };
      const id = b.id ? String(b.id) : db().ref("stake_plans").push().key!;
      if (!idRe.test(id)) throw new HttpError(400, "Invalid id");
      await db().ref(`stake_plans/${id}`).set(data);
      await adminLog(who, b.id ? "edit_stake_plan" : "add_stake_plan", { id, name, days: data.days, pct });
      return void res.json({ success: true, id });
    }
    case "deleteStakePlan": {
      const id = String(b.id || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid id");
      await db().ref(`stake_plans/${id}`).remove(); // চলমান stake অক্ষত থাকে
      await adminLog(who, "delete_stake_plan", { id });
      return void res.json({ success: true });
    }

    case "resetPin": {
      const uid = String(b.uid || "");
      if (!/^\d{1,20}$/.test(uid)) throw new HttpError(400, "Invalid user id");
      await db().ref(`user_prefs/${uid}/pin`).remove();
      await adminLog(who, "reset_pin", { uid });
      await notify(uid, "🔐 Your withdraw PIN was reset by support. You can set a new one in Profile → Settings.");
      return void res.json({ success: true });
    }

    case "marketStatus": {
      const st = await getSettings(true);
      const p = await getPrice(st, true);
      const live = p?.override ? await getPrice({ ...st, price_override: 0 }, true) : p;
      return void res.json({ success: true, price: p, live });
    }

    case "supportList": {
      const items = (await recent("tickets", 200)).map((x: any) => ({ id: x.id, uid: x.uid, name: x.name, subject: x.subject, status: x.status, updated_at: x.updated_at, created_at: x.created_at, n: Object.keys(x.msgs || {}).length }));
      return void res.json({ success: true, items: items.sort((a: any, b: any) => b.updated_at - a.updated_at) });
    }
    case "supportGet": {
      const id = String(b.id || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid id");
      const x = (await db().ref(`tickets/${id}`).get()).val();
      if (!x) throw new HttpError(404, "Ticket not found");
      return void res.json({ success: true, ticket: { id, uid: x.uid, name: x.name, subject: x.subject, status: x.status, msgs: Object.values(x.msgs || {}).sort((a: any, c: any) => a.at - c.at) } });
    }
    case "supportReply":
    case "supportClose": {
      const id = String(b.id || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid id");
      const x = (await db().ref(`tickets/${id}`).get()).val();
      if (!x) throw new HttpError(404, "Ticket not found");
      const now = Date.now();
      const upd: Record<string, any> = {};
      let status = "closed";
      if (action === "supportReply") {
        const text = clean(b.message, 1000);
        if (text.length < 2) throw new HttpError(400, "Write a reply");
        upd[`tickets/${id}/msgs/${sortableId()}`] = { f: "admin", t: text, at: now };
        status = "answered";
      }
      upd[`tickets/${id}/status`] = status;
      upd[`tickets/${id}/updated_at`] = now;
      upd[`user_tickets/${x.uid}/${id}/status`] = status;
      upd[`user_tickets/${x.uid}/${id}/updated_at`] = now;
      await db().ref().update(upd);
      await notify(x.uid, action === "supportReply" ? `💬 Support replied to "${x.subject}". Open Profile → Support to read it.` : `Your support ticket "${x.subject}" was closed.`);
      await adminLog(who, action === "supportReply" ? "support_reply" : "support_close", { id, uid: x.uid });
      return void res.json({ success: true });
    }

    case "shopList": {
      const shops = ((await db().ref("shops").get()).val() || {}) as Record<string, any>;
      const st = await getSettings(true);
      return void res.json({ success: true, enabled: st.shops_enabled, shops: Object.entries(shops).map(([id, x]) => ({ id, name: x.name, domain: x.domain, login_url: x.login_url, webhook: x.webhook || "", enabled: !!x.enabled, fee_pct: x.fee_pct, allow_tfuel: !!x.allow_tfuel, allow_usdt: !!x.allow_usdt, max_usd: x.max_usd, created_at: x.created_at })) });
    }
    case "shopSave": {
      const name = clean(b.name, 40);
      if (name.length < 2) throw new HttpError(400, "Shop name is required");
      let origin = "";
      try { const uo = new URL(String(b.domain || "").trim()); if (uo.protocol !== "https:") throw 0; origin = uo.origin; } catch { throw new HttpError(400, "Domain must be a full https:// address, e.g. https://myshop.com"); }
      let login = clean(b.login_url, 300) || origin + "/auth/tfuel";
      if (!login.startsWith(origin + "/")) throw new HttpError(400, "Login URL must be on the shop's domain");
      let hook = clean(b.webhook, 300);
      if (hook && !/^https:\/\//.test(hook)) throw new HttpError(400, "Webhook URL must start with https://");
      const fee = Number(b.fee_pct), max = Number(b.max_usd);
      if (!Number.isFinite(fee) || fee < 0 || fee > 50) throw new HttpError(400, "Fee must be 0–50%");
      if (!Number.isFinite(max) || max < 1 || max > 100000) throw new HttpError(400, "Max order must be 1–100000 USD");
      if (!b.allow_tfuel && !b.allow_usdt) throw new HttpError(400, "Allow at least one currency");
      const rec: Record<string, any> = { name, domain: origin, login_url: login, webhook: hook, fee_pct: fee, max_usd: max, allow_tfuel: !!b.allow_tfuel, allow_usdt: !!b.allow_usdt, enabled: b.enabled !== false };
      let id = String(b.id || "");
      let secret = "";
      if (id) {
        if (!idRe.test(id) || !(await db().ref(`shops/${id}`).get()).exists()) throw new HttpError(404, "Shop not found");
        await db().ref(`shops/${id}`).update(rec);
      } else {
        id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) + "-" + randomToken().slice(0, 5);
        secret = "tfs_" + randomToken() + randomToken();
        await db().ref(`shops/${id}`).set({ ...rec, secret: seal(secret), created_at: Date.now() });
      }
      await adminLog(who, "shop_saved", { id, name });
      return void res.json({ success: true, id, secret });
    }
    case "shopRotate": {
      const id = String(b.id || "");
      if (!idRe.test(id) || !(await db().ref(`shops/${id}`).get()).exists()) throw new HttpError(404, "Shop not found");
      const secret = "tfs_" + randomToken() + randomToken();
      await db().ref(`shops/${id}/secret`).set(seal(secret));
      await adminLog(who, "shop_secret_rotated", { id });
      return void res.json({ success: true, secret });
    }
    case "shopDelete": {
      const id = String(b.id || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid id");
      await db().ref(`shops/${id}`).remove();
      await adminLog(who, "shop_deleted", { id });
      return void res.json({ success: true });
    }
    case "shopToggleAll": {
      await db().ref("settings/shops_enabled").set(!!b.on);
      invalidateSettings();
      await adminLog(who, "shops_toggle", { on: !!b.on });
      return void res.json({ success: true });
    }
    case "shopOrders": {
      const items = await recent("shop_orders", 300);
      const shops = ((await db().ref("shops").get()).val() || {}) as Record<string, any>;
      const sum: Record<string, { paid: number; fee: number; refunded: number; n: number }> = {};
      for (const o of items) {
        const s0 = (sum[o.shop] = sum[o.shop] || { paid: 0, fee: 0, refunded: 0, n: 0 });
        if (o.status === "paid") { s0.paid += fromU(o.usd_u); s0.fee += fromU(o.fee_u || 0); s0.n++; }
        if (o.status === "refunded") s0.refunded += fromU(o.usd_u);
      }
      return void res.json({ success: true, items: items.map((o: any) => ({ id: o.id, shop: o.shop, shop_name: shops[o.shop]?.name || o.shop, ref: o.ref, title: o.title, usd: fromU(o.usd_u), status: o.status === "open" && o.exp < Date.now() ? "expired" : o.status, cur: o.cur || null, coins: o.coins || 0, usdt: fromU(o.usdt_u || 0), fee: fromU(o.fee_u || 0), uid: o.paid_by || o.uid || "", created_at: o.created_at, paid_at: o.paid_at || 0, webhook_ok: o.webhook_ok })), totals: Object.entries(sum).map(([id, v]) => ({ id, name: shops[id]?.name || id, ...v, owed: v.paid - v.fee })) });
    }
    case "shopRefund": {
      const id = String(b.id || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid id");
      await refundOrder(id, who);
      return void res.json({ success: true });
    }

    case "deposits":
      return void res.json({ success: true, items: await recent("deposits", 300) });
    case "usdtWithdrawals":
      return void res.json({ success: true, items: await recent("usdt_withdrawals", 300) });
    case "trades":
      return void res.json({ success: true, items: await recent("trades", 200) });

    case "approveDeposit":
    case "rejectDeposit": {
      const id = String(b.id || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid id");
      const approve = action === "approveDeposit";
      let credit = 0;
      if (approve) {
        credit = Number(b.amount);
        if (!Number.isFinite(credit) || credit <= 0 || credit > 1e6) throw new HttpError(400, "Enter the amount actually received");
      }
      await settleDeposit(id, approve, credit, clean(b.note, 200), who);
      liab = null;
      return void res.json({ success: true });
    }

    /* ---- Binance (read-only key) ---- */
    case "binanceStatus": {
      const st = await getSettings(true);
      return void res.json({ success: true, key: await credHint(), auto: st.binance_auto, max: st.binance_auto_max, last: (await db().ref("stats/binance_check").get()).val() });
    }
    case "binanceSave": {
      const key = clean(b.key, 128), secret = clean(b.secret, 128);
      if (key.length < 20 || secret.length < 20) throw new HttpError(400, "Paste both the API key and the secret");
      const chk = await checkKey({ key, secret, src: "db" }).catch((e: any) => { throw new HttpError(400, e?.message || "Binance rejected this key"); });
      if (!chk.ok) throw new HttpError(400, "Key rejected: " + chk.problems.join("; ") + ". Create a key with ONLY “Enable Reading”.");
      await saveCreds(key, secret);
      await db().ref("stats/binance_check").set({ at: Date.now(), ok: true, msg: "Key saved and verified (read-only)" });
      await adminLog(who, "binance_key_saved", {});
      return void res.json({ success: true });
    }
    case "binanceTest": {
      const c = await getCreds();
      if (!c) throw new HttpError(400, "No Binance key saved");
      let out: any;
      try {
        const chk = await checkKey(c);
        let extra = "";
        if (chk.ok) {
          const probe = async (label: string, f: () => Promise<any>) => { try { await f(); extra += ` · ${label}: OK`; } catch (e: any) { extra += ` · ${label}: FAILED (${e?.message || "error"})`; } };
          await probe("Deposit history", () => recentDeposits(c, 1));
          await probe("Binance Pay history", () => payReceived(c, Date.now() - 86400000));
        }
        out = { at: Date.now(), ok: chk.ok && !/FAILED/.test(extra), msg: chk.ok ? "Connected — key is read-only" + extra : "Unsafe key: " + chk.problems.join("; ") };
      } catch (e: any) {
        out = { at: Date.now(), ok: false, msg: e?.message || "Check failed" };
      }
      await db().ref("stats/binance_check").set(out);
      return void res.json({ success: true, result: out });
    }
    case "binanceClear": {
      await clearCreds();
      await adminLog(who, "binance_key_removed", {});
      return void res.json({ success: true });
    }
    case "starsStatus": {
      const r = await tgCall("getWebhookInfo");
      const url = String(r.result?.url || "");
      return void res.json({ success: true, connected: !!url && url.endsWith("/api/tg-webhook"), url, pending: r.result?.pending_update_count || 0, error: r.result?.last_error_message || "" });
    }
    case "starsConnect": {
      const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
      if (!host || /localhost/.test(host)) throw new HttpError(400, "Open the admin panel from your live site to connect");
      const r = await tgCall("setWebhook", { url: `https://${host}/api/tg-webhook`, secret_token: webhookSecret(), allowed_updates: JSON.stringify(["message", "pre_checkout_query"]), drop_pending_updates: "false" });
      if (!r.ok) throw new HttpError(400, r.description || "Telegram refused the webhook");
      await adminLog(who, "stars_webhook_connected", { host });
      return void res.json({ success: true });
    }
    case "binanceRecheck":
      return void res.json({ success: true, ...(await recheckAuto()) });

    case "payUsdt":
    case "rejectUsdt": {
      const id = String(b.id || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid id");
      const pay = action === "payUsdt";
      const note = clean(b.note, 200);
      let rec: any = null;
      await db()
        .ref(`usdt_withdrawals/${id}`)
        .transaction((w: any) => {
          rec = null;
          if (w === null) return w;
          if (w.status !== "pending") return;
          w.status = pay ? "paid" : "rejected";
          w.handled_at = Date.now();
          w.note = note;
          rec = { ...w };
          return w;
        });
      if (!rec) throw new HttpError(409, "not_pending");
      const upd: Record<string, any> = {
        [`users/${rec.uid}/usdt_withdrawals/${id}/status`]: rec.status,
        [`users/${rec.uid}/usdt_withdrawals/${id}/note`]: note || null,
      };
      if (!pay) {
        upd[`users/${rec.uid}/usdt_u`] = ServerValue.increment(toU(Number(rec.amount)));
        upd[`users/${rec.uid}/usdt_tot/withdrawn`] = ServerValue.increment(-toU(Number(rec.amount)));
      }
      await db().ref().update(upd);
      await activity(rec.uid, pay ? "usdt_paid" : "usdt_rejected", { usdt_u: toU(Number(rec.amount)), note });
      await notify(rec.uid, pay ? `✅ Your USDT withdrawal of ${rec.amount} USDT has been paid.` : `↩️ Your USDT withdrawal was rejected and ${rec.amount} USDT was refunded.${note ? " Reason: " + note : ""}`);
      await adminLog(who, pay ? "usdt_paid" : "usdt_rejected", { id, uid: rec.uid, amount: rec.amount, note });
      liab = null;
      return void res.json({ success: true });
    }

    case "adjustUsdt": {
      const uid = String(b.uid || "").trim();
      if (!/^\d{1,20}$/.test(uid)) throw new HttpError(400, "Invalid user id");
      const delta = toU(Number(b.delta));
      if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > toU(1e6)) throw new HttpError(400, "Invalid amount");
      const reason = clean(b.reason, 200);
      if (reason.length < 3) throw new HttpError(400, "A reason is required");
      let missing = false;
      let err = "";
      let after = 0;
      await db()
        .ref(`users/${uid}`)
        .transaction((cur: UserRecord | null) => {
          err = "";
          missing = cur === null;
          if (cur === null) return cur;
          if ((cur.usdt_u || 0) + delta < 0) {
            err = "USDT balance can't go below zero";
            return;
          }
          cur.usdt_u = (cur.usdt_u || 0) + delta;
          usdtTot(cur, "adjusted", delta);
          after = cur.usdt_u;
          return cur;
        });
      if (missing) throw new HttpError(404, "User not found");
      if (err) throw new HttpError(409, err);
      await activity(uid, "adjust", { usdt_u: delta, note: reason });
      await adminLog(who, "adjust_usdt", { uid, delta: fromU(delta), reason });
      liab = null;
      return void res.json({ success: true, usdt: fromU(after) });
    }

    case "promoList": {
      const v = ((await db().ref("promo").get()).val() || {}) as Record<string, any>;
      return void res.json({ success: true, items: Object.entries(v).map(([code, p]) => ({ code, ...p })).sort((a, b) => (b.created || 0) - (a.created || 0)) });
    }
    case "savePromo": {
      const code = String(b.code || "").trim().toUpperCase();
      if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw new HttpError(400, "Code must be 3-24 letters, numbers, - or _");
      const coins = Math.floor(Number(b.coins));
      if (!Number.isFinite(coins) || coins < 1 || coins > 1e9) throw new HttpError(400, "Invalid reward");
      const max = Math.floor(Number(b.max) || 0);
      if (max < 0 || max > 1e7) throw new HttpError(400, "Invalid max uses");
      const days = Number(b.days) || 0;
      if (days < 0 || days > 3650) throw new HttpError(400, "Invalid expiry");
      const prev = (await db().ref(`promo/${code}`).get()).val() || {};
      const rec = { coins, max, used: prev.used || 0, active: b.active === undefined ? true : !!b.active, exp: days > 0 ? Date.now() + days * 86400000 : b.keepExp ? prev.exp || 0 : 0, created: prev.created || Date.now(), note: clean(b.note, 80) };
      await db().ref(`promo/${code}`).set(rec);
      await adminLog(who, "promo_saved", { code, coins, max, days });
      return void res.json({ success: true });
    }
    case "deletePromo": {
      const code = String(b.code || "").trim().toUpperCase();
      if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw new HttpError(400, "Invalid code");
      await db().ref(`promo/${code}`).remove();
      await adminLog(who, "promo_deleted", { code });
      return void res.json({ success: true });
    }
    case "lbView": {
      const board = ["all"].includes(String(b.board)) ? "all" : /^w_\d+$/.test(String(b.board)) ? String(b.board) : `w_${weekIndex()}`;
      const t = await top(board, 20);
      const nm = await names(t.map((x) => x.id));
      return void res.json({ success: true, board, week: weekIndex(), list: t.map((x, i) => ({ rank: i + 1, id: x.id, name: nm[x.id], v: x.v })) });
    }
    case "lbPayout": {
      const idx = b.week === undefined ? weekIndex() - 1 : Math.floor(Number(b.week));
      if (!Number.isFinite(idx) || idx >= weekIndex()) throw new HttpError(400, "Only finished weeks can be paid");
      const r = await payWeek(idx, await getSettings(true));
      await adminLog(who, "lb_payout", r as any);
      liab = null;
      return void res.json({ success: true, result: r });
    }
    case "engageStats": {
      const [oo, os, ob, aa, ab, pr, lock, cron] = await Promise.all([
        db().ref("orderx_sell").get(), db().ref("orderx_buy").get(), db().ref("orders").orderByKey().limitToLast(30).get(),
        db().ref("alert_above").get(), db().ref("alert_below").get(), db().ref("promo").get(), db().ref("lb_paid").get(), db().ref("stats/cron_at").get(),
      ]);
      const cnt = (x: any) => Object.keys(x.val() || {}).length;
      const orders: any[] = [];
      ob.forEach((c) => { orders.push({ id: c.key, ...c.val() }); });
      return void res.json({ success: true, openSell: cnt(oo), openBuy: cnt(os), alerts: cnt(aa) + cnt(ab), promos: cnt(pr), paidWeeks: Object.keys(lock.val() || {}), cronAt: cron.val() || 0, orders: orders.reverse() });
    }
    case "runTriggers": {
      const p = await getPrice(await getSettings(true));
      const r = await processTriggers(p && !p.stale ? p.price : null);
      return void res.json({ success: true, ...r, price: p?.price || null });
    }

    case "getSettings": {
      return void res.json({ success: true, settings: await getSettings(true) });
    }

    case "saveSettings": {
      const cur = await getSettings(true);
      const next = parseSettings(b.settings || {}, cur);
      await db().ref("settings").set(next);
      invalidateSettings();
      const changed = Object.keys(next).filter((k) => JSON.stringify((next as any)[k]) !== JSON.stringify((cur as any)[k]));
      await adminLog(who, "save_settings", { changed });
      return void res.json({ success: true, settings: next });
    }

    case "logs": {
      const snap = await db().ref("admin_logs").orderByKey().limitToLast(200).get();
      const logs: any[] = [];
      snap.forEach((c) => {
        logs.push({ id: c.key, ...c.val() });
      });
      return void res.json({ success: true, logs: logs.reverse() });
    }

    case "fraud": {
      const [fl, wds, index] = await Promise.all([db().ref("flags").get(), recentWithdrawals(500), userIndex()]);
      const flagged = Object.entries((fl.val() || {}) as Record<string, any>)
        .map(([uid, f]) => {
          const score = (f.too_fast || 0) + (f.bad_codes || 0) * 2 + (f.locked || 0) * 3 + (f.out_of_order || 0);
          return { uid, name: index[uid]?.name || "", ...f, score };
        })
        .sort((a, b2) => b2.score - a.score)
        .slice(0, 50);
      const byAcct: Record<string, { account: string; method: string; uids: Set<string> }> = {};
      for (const w of wds) {
        const k = norm(w.account);
        if (!k) continue;
        (byAcct[k] = byAcct[k] || { account: w.account, method: w.method, uids: new Set() }).uids.add(w.uid);
      }
      const shared = Object.values(byAcct)
        .filter((x) => x.uids.size > 1)
        .map((x) => ({ account: x.account, method: x.method, users: Array.from(x.uids) }));
      return void res.json({ success: true, flagged, shared });
    }

    case "checkChannel": {
      const ch = String(b.channel_id || "").trim();
      if (!/^@[A-Za-z0-9_]{4,}$/.test(ch) && !/^-100\d+$/.test(ch)) throw new HttpError(400, "channel_id must be @username or -100…");
      const me = await tgCall("getMe");
      if (!me.ok) return void res.json({ success: true, ok: false, step: "bot", message: `Bot token problem: ${me.description}` });
      const chat = await tgCall("getChat", { chat_id: ch });
      if (!chat.ok) {
        return void res.json({ success: true, ok: false, step: "chat", bot: me.result.username, message: `Bot can't see this channel: ${chat.description}. Check the @username, and add the bot to the channel.` });
      }
      const mem = await tgCall("getChatMember", { chat_id: ch, user_id: me.result.id });
      const status = mem.ok ? mem.result?.status : "unknown";
      const isAdmin = status === "administrator" || status === "creator";
      return void res.json({
        success: true,
        ok: isAdmin,
        bot: me.result.username,
        title: chat.result.title || "",
        type: chat.result.type,
        status,
        message: isAdmin
          ? "All good — the bot is an administrator and can verify members."
          : "The bot is in the channel but is not an administrator. Make it an admin so it can check who joined.",
      });
    }

    case "diagnostics": {
      const d = ((await db().ref("diagnostics/telegram").get()).val() || {}) as Record<string, any>;
      return void res.json({ success: true, items: Object.entries(d).map(([taskId, v]) => ({ taskId, ...v })).sort((a, b2) => b2.at - a.at) });
    }

    case "saveSite": {
      const data = parseSite(b);
      let id = String(b.siteId || "");
      if (id && !idRe.test(id)) throw new HttpError(400, "Invalid siteId");
      if (!id) id = db().ref("article_sites").push().key!;
      await db().ref(`article_sites/${id}`).set(data);
      await adminLog(who, b.siteId ? "edit_site" : "add_site", { id, name: data.name });
      return void res.json({ success: true, siteId: id });
    }

    case "toggleSite": {
      const id = String(b.siteId || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid siteId");
      await db().ref(`article_sites/${id}/is_active`).set(!!b.active);
      await adminLog(who, b.active ? "enable_site" : "disable_site", { id });
      return void res.json({ success: true });
    }

    case "deleteSite": {
      const id = String(b.siteId || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid siteId");
      await db().ref(`article_sites/${id}`).remove();
      await adminLog(who, "delete_site", { id });
      return void res.json({ success: true });
    }

    case "payWithdrawal":
    case "rejectWithdrawal": {
      const id = String(b.id || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid id");
      const next = action === "payWithdrawal" ? "paid" : "rejected";
      const note = String(b.note || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200);

      // pending থেকে একবারই বদলানো যায় (দুইবার pay/refund আটকায়)
      let rec: any = null;
      await db()
        .ref(`withdrawals/${id}`)
        .transaction((w: any) => {
          rec = null;
          if (w === null) return w;
          if (w.status !== "pending") return;
          w.status = next;
          w.handled_at = Date.now();
          w.note = note;
          rec = { ...w };
          return w;
        });
      if (!rec) throw new HttpError(409, "not_pending");

      const upd: Record<string, any> = { [`users/${rec.uid}/withdrawals/${id}/status`]: next };
      if (next === "rejected") {
        upd[`users/${rec.uid}/balance`] = ServerValue.increment(Number(rec.amount));
        upd[`users/${rec.uid}/spent/withdrawn`] = ServerValue.increment(-Number(rec.amount));
      }
      await db().ref().update(upd);
      await adminLog(who, next === "paid" ? "withdraw_paid" : "withdraw_rejected", { id, uid: rec.uid, amount: rec.amount, note });
      await notify(rec.uid, next === "paid" ? "✅ Your withdrawal has been paid." : "↩️ Your withdrawal was rejected and the coins were refunded.");
      liab = null;
      return void res.json({ success: true });
    }

    case "saveTask": {
      const type = String(b.type || "");
      const base = {
        type,
        title: String(b.title || "").slice(0, 80),
        reward: posInt(b.reward, "reward"),
        one_time: true,
      };
      if (!base.title) throw new HttpError(400, "Title required");

      let data: Record<string, any>;
      if (type === "telegram_join") {
        const ch = String(b.channel_id || "").trim();
        if (!/^@[A-Za-z0-9_]{4,}$/.test(ch) && !/^-100\d+$/.test(ch)) {
          throw new HttpError(400, "channel_id must be @username or -100…");
        }
        data = { ...base, channel_id: ch, url: b.url ? httpsUrl(b.url, "url") : null };
      } else if (type === "timer_visit") {
        data = {
          ...base,
          url: httpsUrl(b.url, "url"),
          min_wait_seconds: posInt(b.min_wait_seconds || 10, "min_wait_seconds", 300),
        };
      } else {
        throw new HttpError(400, "Unknown task type");
      }

      const id = b.id ? String(b.id) : db().ref("tasks").push().key!;
      if (!idRe.test(id)) throw new HttpError(400, "Invalid id");
      await db().ref(`tasks/${id}`).set(data);
      await adminLog(who, "save_task", { id, title: data.title });
      return void res.json({ success: true, id });
    }

    case "deleteTask": {
      const id = String(b.taskId || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid taskId");
      await db().ref(`tasks/${id}`).remove();
      await adminLog(who, "delete_task", { id });
      return void res.json({ success: true });
    }

    default:
      throw new HttpError(400, "Unknown action");
  }
});
