import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ServerValue } from "firebase-admin/database";
import { sortableId } from "@/lib/crypto";
import { ensureUser, newUser, MAX_AUTH_AGE_MONEY, UserRecord } from "@/lib/user";
import { toU, U } from "@/lib/market";

/** USDT withdraw: ব্যালেন্স আগে কাটা, admin হাতে পাঠিয়ে paid করে / বাতিলে ফেরত */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "usdt-withdraw", 6);
  const { u: rec, settings: s } = await ensureUser(user);
  if (!s.payout_enabled) throw new HttpError(403, "withdraw_disabled");

  const net = s.payout_networks.find((n) => n.id === String(req.body?.network || ""));
  if (!net) throw new HttpError(400, "bad_network");
  const address = String(req.body?.address || "").replace(/[\u0000-\u001f\u007f\s]/g, "").slice(0, 100);
  if (address.length < 10 || (net.regex && !new RegExp(net.regex).test(address))) throw new HttpError(400, "bad_address");
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount < net.min || amount <= net.fee || amount > 1e6) {
    return void res.status(400).json({ success: false, error: "below_min_usdt", min: Math.max(net.min, net.fee) });
  }
  const amount_u = toU(amount);

  const now = Date.now();
  if (s.new_user_wait_days > 0 && rec.created_at && now < rec.created_at + s.new_user_wait_days * 86400000) {
    return void res.status(403).json({ success: false, error: "too_new", retry_at: rec.created_at + s.new_user_wait_days * 86400000 });
  }
  if (s.daily_withdraw_limit > 0) {
    const n = Object.values(((rec as any).usdt_withdrawals || {}) as Record<string, any>).filter((w) => w.created_at > now - 86400000).length;
    if (n >= s.daily_withdraw_limit) throw new HttpError(429, "daily_limit");
  }

  let err = "";
  let left = 0;
  await db()
    .ref(`users/${user.id}`)
    .transaction((cur: UserRecord | null) => {
      err = "";
      if (cur === null) return newUser();
      if ((cur.usdt_u || 0) < amount_u) {
        err = "insufficient_usdt";
        return;
      }
      cur.usdt_u = (cur.usdt_u || 0) - amount_u;
      left = cur.usdt_u;
      return cur;
    });
  if (err) throw new HttpError(409, err);

  const id = sortableId();
  const data = { network: net.id, network_name: net.name, address, amount, fee: net.fee, receive: Math.round((amount - net.fee) * U) / U, status: "pending", created_at: now };
  try {
    await db()
      .ref()
      .update({
        [`usdt_withdrawals/${id}`]: { ...data, uid: user.id, name: user.first_name || "User" },
        [`users/${user.id}/usdt_withdrawals/${id}`]: data,
      });
  } catch (e) {
    console.error("usdt withdraw record failed, refunding", user.id, amount, e);
    await db()
      .ref()
      .update({ [`users/${user.id}/usdt_u`]: ServerValue.increment(amount_u) })
      .catch((e2) => console.error("REFUND FAILED", user.id, amount, e2));
    throw new HttpError(500, "withdraw_failed");
  }
  res.json({ success: true, id, usdtBalance: left / U, receive: data.receive });
});
