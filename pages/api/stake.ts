import { enqueue } from "@/lib/queue";
import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ServerValue } from "firebase-admin/database";
import { sortableId } from "@/lib/crypto";
import { ensureUser, newUser, MAX_AUTH_AGE_MONEY, UserRecord } from "@/lib/user";

const MAX_ACTIVE = 10;

/** Staking: balance লক করে; মেয়াদ শেষে মূল + নির্ধারিত লাভ ফেরত (claim-stake)। শুধু গেমের balance দিয়ে। */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "stake", 10);
  await ensureUser(user);
  const planId = String(req.body?.planId || "");
  if (!/^[\w-]{1,64}$/.test(planId)) throw new HttpError(400, "Invalid plan");
  const plan = (await db().ref(`stake_plans/${planId}`).get()).val();
  if (!plan || !plan.is_active) throw new HttpError(404, "plan_unavailable");
  const amount = Math.floor(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount < plan.min || amount > plan.max) throw new HttpError(400, "bad_stake_amount");
  const reward = Math.floor((amount * plan.reward_pct) / 100);

  // pool limit (admin-এর মোট দায় সীমিত রাখতে)
  let poolOk = true;
  if (plan.pool_cap > 0) {
    const r = await db()
      .ref(`stake_pools/${planId}`)
      .transaction((cur: number | null) => {
        const used = cur || 0;
        poolOk = used + amount <= plan.pool_cap;
        return poolOk ? used + amount : undefined;
      });
    if (!r.committed || !poolOk) throw new HttpError(409, "pool_full");
  }

  const id = sortableId();
  const now = Date.now();
  let err = "";
  let balance = 0;
  await db()
    .ref(`users/${user.id}`)
    .transaction((cur: UserRecord | null) => {
      err = "";
      if (cur === null) return newUser();
      if (cur.balance < amount) {
        err = "insufficient";
        return;
      }
      const active = Object.values(cur.stakes || {}).filter((k) => k.status === "active").length;
      if (active >= MAX_ACTIVE) {
        err = "too_many_stakes";
        return;
      }
      cur.balance -= amount;
      cur.stakes = cur.stakes || {};
      cur.stakes[id] = { plan_id: planId, name: plan.name, amount, reward, start: now, end: now + plan.days * 86400000, status: "active" };
      balance = cur.balance;
      return cur;
    });
  if (err) {
    if (plan.pool_cap > 0) await db().ref().update({ [`stake_pools/${planId}`]: ServerValue.increment(-amount) }).catch(() => {});
    throw new HttpError(409, err);
  }
  await enqueue("stake", now + plan.days * 86400000, `${user.id}_${id}`, { uid: user.id, total: amount + reward });
  res.json({ success: true, id, reward, balance });
});
