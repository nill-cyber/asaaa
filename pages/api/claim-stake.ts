import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ServerValue } from "firebase-admin/database";
import { ensureUser, newUser, MAX_AUTH_AGE_MONEY, UserRecord } from "@/lib/user";

export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "claim-stake", 20);
  await ensureUser(user);
  const id = String(req.body?.id || "");
  if (!/^[\w-]{1,64}$/.test(id)) throw new HttpError(400, "Invalid id");
  let err = "";
  let paid = 0;
  let balance = 0;
  let planId = "";
  let amount = 0;
  await db()
    .ref(`users/${user.id}`)
    .transaction((cur: UserRecord | null) => {
      err = "";
      if (cur === null) return newUser();
      const k = cur.stakes?.[id];
      if (!k) {
        err = "not_found";
        return;
      }
      if (k.status !== "active") {
        err = "already_claimed";
        return;
      }
      if (k.end > Date.now()) {
        err = "stake_not_ready";
        return;
      }
      k.status = "claimed";
      paid = k.amount + k.reward;
      planId = k.plan_id;
      amount = k.amount;
      cur.balance += paid;
      balance = cur.balance;
      return cur;
    });
  if (err) throw new HttpError(409, err);
  await db().ref().update({ [`stake_pools/${planId}`]: ServerValue.increment(-amount) }).catch(() => {});
  res.json({ success: true, paid, balance });
});
