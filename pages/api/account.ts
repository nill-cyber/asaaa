import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { sortableId } from "@/lib/crypto";
import { ensureUser, MAX_AUTH_AGE_MONEY } from "@/lib/user";
import crypto from "crypto";
import { checkPin, pinHash } from "@/lib/prefs";
import { tgCall } from "@/lib/telegram";
import { notify } from "@/lib/notify";

const clean = (v: any, n: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);

/** Settings: Withdraw PIN ও Saved addresses (user_prefs/{uid}) */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "account", 30);
  await ensureUser(user, { soft: true });
  const action = String(req.body?.action || "get");
  const base = `user_prefs/${user.id}`;

  if (action === "setPin") {
    const pin = String(req.body?.pin || "");
    if (!/^\d{4,6}$/.test(pin)) throw new HttpError(400, "bad_pin");
    await checkPin(user.id, req.body?.current); // আগে থেকে PIN থাকলে বর্তমানটা লাগবে
    await db().ref(`${base}/pin`).set({ h: pinHash(user.id, pin), fails: 0, set_at: Date.now() });
  } else if (action === "removePin") {
    await checkPin(user.id, req.body?.current);
    await db().ref(`${base}/pin`).remove();
  } else if (action === "addAddr") {
    const label = clean(req.body?.label, 20);
    const address = clean(req.body?.address, 100).replace(/\s/g, "");
    if (!label || address.length < 6) throw new HttpError(400, "bad_address");
    const cur = ((await db().ref(`${base}/addrs`).get()).val() || {}) as Record<string, any>;
    if (Object.keys(cur).length >= 10) throw new HttpError(400, "too_many_addrs");
    await db().ref(`${base}/addrs/${sortableId()}`).set({ label, address });
  } else if (action === "delAddr") {
    const id = String(req.body?.id || "");
    if (!/^[\w-]{1,40}$/.test(id)) throw new HttpError(400, "bad_request");
    await db().ref(`${base}/addrs/${id}`).remove();
  } else if (action === "setCur") {
    const c = String(req.body?.cur || "");
    if (c !== "tfuel" && c !== "usdt") throw new HttpError(400, "bad_request");
    await db().ref(`${base}/cur`).set(c);
  } else if (action === "setLoginAlert") {
    await db().ref(`${base}/login_alert`).set(!!req.body?.on);
  } else if (action === "pinResetRequest") {
    // PIN ভুলে গেলে: Telegram bot-এ ৬ ডিজিটের কোড (১০ মিনিট)
    if (!(await db().ref(`${base}/pin`).get()).exists()) throw new HttpError(400, "no_pin");
    const old = (await db().ref(`${base}/reset`).get()).val();
    if (old && Date.now() - (old.sent_at || 0) < 60000) throw new HttpError(429, "wait_a_minute");
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const r = await tgCall("sendMessage", { chat_id: user.id, text: `🔐 Your PIN reset code: ${code}\nIt expires in 10 minutes. If this wasn't you, ignore this message.` });
    if (!r.ok) throw new HttpError(409, "bot_not_started");
    await db().ref(`${base}/reset`).set({ h: pinHash(user.id, "reset" + code), exp: Date.now() + 600000, fails: 0, sent_at: Date.now() });
  } else if (action === "pinResetConfirm") {
    const code = String(req.body?.code || "");
    const pin = String(req.body?.pin || "");
    if (!/^\d{6}$/.test(code) || !/^\d{4,6}$/.test(pin)) throw new HttpError(400, "bad_request");
    const rs = (await db().ref(`${base}/reset`).get()).val() as { h: string; exp: number; fails: number } | null;
    if (!rs || rs.exp < Date.now() || (rs.fails || 0) >= 5) throw new HttpError(400, "reset_expired");
    const okc = crypto.timingSafeEqual(Buffer.from(pinHash(user.id, "reset" + code), "hex"), Buffer.from(rs.h, "hex"));
    if (!okc) {
      await db().ref(`${base}/reset/fails`).set((rs.fails || 0) + 1);
      throw new HttpError(403, "reset_wrong");
    }
    await db().ref().update({ [`${base}/pin`]: { h: pinHash(user.id, pin), fails: 0, set_at: Date.now() }, [`${base}/reset`]: null });
    await notify(user.id, "🔐 Your withdraw PIN was reset.");
  } else if (action !== "get") throw new HttpError(400, "bad_request");

  const p = ((await db().ref(base).get()).val() || {}) as any;
  res.json({
    success: true,
    pin: !!p.pin,
    pin_locked: (p.pin?.lock_until || 0) > Date.now(),
    cur: p.cur === "usdt" || p.cur === "tfuel" ? p.cur : null,
    login_alert: p.login_alert !== false,
    devices: Object.values((p.devices || {}) as Record<string, any>).sort((a: any, b: any) => b.last - a.last).slice(0, 5).map((d: any) => ({ label: d.label, last: d.last, first: d.first })),
    addrs: Object.entries((p.addrs || {}) as Record<string, any>).map(([id, a]) => ({ id, label: a.label, address: a.address })),
  });
});
