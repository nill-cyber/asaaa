import { requireAdmin, HttpError } from "@/lib/auth";
import { route } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ServerValue } from "firebase-admin/database";
import { ArticleSite, normUrl } from "@/lib/chain";
import { adminLog, dayKey } from "@/lib/log";
import { getSettings, invalidateSettings, parseSettings } from "@/lib/settings";
import { tgCall } from "@/lib/telegram";
import type { UserRecord } from "@/lib/user";
import { getPrice, fromU, toU } from "@/lib/market";

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
  return {
    name,
    urls,
    reward: posInt(b.reward, "reward", 1e7, 1),
    cooldown_minutes: posInt(b.cooldown_minutes, "cooldown_minutes", 60 * 24 * 30),
    dwell_seconds: posInt(b.dwell_seconds ?? 15, "dwell_seconds", 300, 5),
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
          after = cur.balance;
          return cur;
        });
      if (missing) throw new HttpError(404, "User not found");
      if (err) throw new HttpError(409, err);
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

    case "marketStatus": {
      const st = await getSettings(true);
      const p = await getPrice(st, true);
      const live = p?.override ? await getPrice({ ...st, price_override: 0 }, true) : p;
      return void res.json({ success: true, price: p, live });
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
      const note = clean(b.note, 200);
      let credit = 0;
      if (approve) {
        credit = Number(b.amount);
        if (!Number.isFinite(credit) || credit <= 0 || credit > 1e6) throw new HttpError(400, "Enter the amount actually received");
      }
      let rec: any = null;
      await db()
        .ref(`deposits/${id}`)
        .transaction((d: any) => {
          rec = null;
          if (d === null) return d;
          if (d.status !== "pending") return;
          d.status = approve ? "approved" : "rejected";
          d.handled_at = Date.now();
          d.note = note;
          if (approve) d.credited = credit;
          rec = { ...d };
          return d;
        });
      if (!rec) throw new HttpError(409, "not_pending");
      const upd: Record<string, any> = {
        [`users/${rec.uid}/deposits/${id}/status`]: rec.status,
        [`users/${rec.uid}/deposits/${id}/note`]: note || null,
      };
      if (approve) {
        upd[`users/${rec.uid}/usdt_u`] = ServerValue.increment(toU(credit));
        upd[`users/${rec.uid}/deposits/${id}/credited`] = credit;
      } else {
        upd[`deposit_txids/${rec.txkey}`] = null; // বাতিল হলে txid আবার জমা দেওয়া যাবে
      }
      await db().ref().update(upd);
      await adminLog(who, approve ? "deposit_approved" : "deposit_rejected", { id, uid: rec.uid, claimed: rec.amount, credited: approve ? credit : 0, note });
      liab = null;
      return void res.json({ success: true });
    }

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
      if (!pay) upd[`users/${rec.uid}/usdt_u`] = ServerValue.increment(toU(Number(rec.amount)));
      await db().ref().update(upd);
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
          after = cur.usdt_u;
          return cur;
        });
      if (missing) throw new HttpError(404, "User not found");
      if (err) throw new HttpError(409, err);
      await adminLog(who, "adjust_usdt", { uid, delta: fromU(delta), reason });
      liab = null;
      return void res.json({ success: true, usdt: fromU(after) });
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
      if (next === "rejected") upd[`users/${rec.uid}/balance`] = ServerValue.increment(Number(rec.amount));
      await db().ref().update(upd);
      await adminLog(who, next === "paid" ? "withdraw_paid" : "withdraw_rejected", { id, uid: rec.uid, amount: rec.amount, note });
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
