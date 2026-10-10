import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ServerValue } from "firebase-admin/database";
import { sortableId } from "@/lib/crypto";
import { MIN_WITHDRAW, WITHDRAW_METHODS } from "@/lib/config";
import { ensureUser, newUser, UserRecord, MAX_AUTH_AGE_MONEY } from "@/lib/user";

/** Withdraw অনুরোধ: coin আগে কেটে নেওয়া হয়, admin টাকা পাঠালে paid / বাতিল করলে ফেরত */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "withdraw", 10);

  const amount = Math.floor(Number(req.body?.amount));
  const method = String(req.body?.method || "");
  const account = String(req.body?.account || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 100);

  if (!Number.isFinite(amount) || amount < MIN_WITHDRAW) {
    return void res.status(400).json({ success: false, error: "below_minimum", min: MIN_WITHDRAW });
  }
  if (!WITHDRAW_METHODS.includes(method)) throw new HttpError(400, "bad_method");
  if (account.length < 4) throw new HttpError(400, "bad_account");

  await ensureUser(user.id);

  // আগে balance কেটে নিই (atomic); না থাকলে অনুরোধ বাতিল
  let out: { error?: string; balance?: number } = {};
  await db()
    .ref(`users/${user.id}`)
    .transaction((cur: UserRecord | null) => {
      out = {};
      if (cur === null) return newUser();
      if ((cur.balance || 0) < amount) {
        out = { error: "insufficient" };
        return;
      }
      cur.balance -= amount;
      out = { balance: cur.balance };
      return cur;
    });
  if (out.error) throw new HttpError(409, out.error);

  const id = sortableId();
  const now = Date.now();
  try {
    await db().ref().update({
      [`withdrawals/${id}`]: {
        uid: user.id,
        name: user.first_name || "User",
        amount,
        method,
        account,
        status: "pending",
        created_at: now,
      },
      [`users/${user.id}/withdrawals/${id}`]: { amount, method, status: "pending", created_at: now },
    });
  } catch (e) {
    console.error("withdraw record failed, refunding", user.id, amount, e);
    await db()
      .ref()
      .update({ [`users/${user.id}/balance`]: ServerValue.increment(amount) })
      .catch((e2) => console.error("REFUND FAILED", user.id, amount, e2));
    throw new HttpError(500, "withdraw_failed");
  }

  res.json({ success: true, id, balance: out.balance });
});
