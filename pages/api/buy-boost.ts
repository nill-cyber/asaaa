import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { spend, activity } from "@/lib/wallet";
import { ensureUser, newUser, settleMining, quoteBoost, MAX_AUTH_AGE_MONEY, UserRecord } from "@/lib/user";

/** Boost কেনা (শুধু গেমের balance দিয়ে)। কেনার আগে জমে থাকা mining নিজে থেকে জমা হয়। */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "buy-boost", 10);
  const { settings: s } = await ensureUser(user);
  const id = String(req.body?.planId || "");
  if (!/^[\w-]{1,64}$/.test(id)) throw new HttpError(400, "Invalid plan");
  const plan = (await db().ref(`boost_plans/${id}`).get()).val();
  if (!plan || !plan.is_active) throw new HttpError(404, "plan_unavailable");

  let err = "";
  let kind = "buy";
  let out: any = { balance: 0, collected: 0, paid: 0 };
  const now = Date.now();
  await db()
    .ref(`users/${user.id}`)
    .transaction((cur: UserRecord | null) => {
      err = "";
      if (cur === null) return newUser();
      const q = quoteBoost(cur.boosts, { id, price: plan.price, duration_days: plan.duration_days }, now);
      if (q.kind === "current" || q.kind === "queued") {
        err = "boost_active";
        return;
      }
      if (q.kind === "blocked") {
        err = "boost_blocked";
        return;
      }
      if (cur.balance + q.queuedRefund < q.cost) {
        err = "insufficient";
        return;
      }
      const collected = settleMining(cur, s.mine_cap_hours, now);
      cur.balance += q.queuedRefund - q.cost;
      if (q.cost) spend(cur, "boosts", q.cost);
      cur.boosts = cur.boosts || {};
      if (q.kind === "upgrade") for (const k of [...q.activeIds, ...q.queuedIds]) delete cur.boosts[k];
      const startsAt = q.startsAt;
      cur.boosts[id] = {
        name: plan.name,
        bought_at: now,
        starts_at: startsAt > now ? startsAt : undefined,
        expires_at: plan.duration_days > 0 ? startsAt + plan.duration_days * 86400000 : 0,
        tap: plan.tap_bonus || 0,
        en: plan.energy_bonus || 0,
        regen: plan.regen_bonus || 0,
        mph: plan.mine_per_hour || 0,
        price: plan.price,
        paid: q.cost,
      } as any;
      if (cur.boosts[id].starts_at === undefined) delete (cur.boosts[id] as any).starts_at;
      kind = q.kind;
      out = { balance: cur.balance, collected, paid: q.cost };
      return cur;
    });
  if (err) throw new HttpError(409, err);
  await activity(user.id, "boost", { coins: -(out as any).paid, note: String(plan.name).slice(0, 40) + (kind === "upgrade" ? " (upgrade)" : kind === "downgrade" ? " (starts later)" : "") });
  res.json({ success: true, kind, ...out });
});
