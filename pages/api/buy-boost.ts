import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { spend, activity } from "@/lib/wallet";
import { ensureUser, newUser, settleMining, boostActive, MAX_AUTH_AGE_MONEY, UserRecord } from "@/lib/user";

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
  let out = { balance: 0, collected: 0 };
  const now = Date.now();
  await db()
    .ref(`users/${user.id}`)
    .transaction((cur: UserRecord | null) => {
      err = "";
      if (cur === null) return newUser();
      const have = cur.boosts?.[id];
      if (have && boostActive(have, now)) {
        err = "boost_active";
        return;
      }
      if (cur.balance < plan.price) {
        err = "insufficient";
        return;
      }
      const collected = settleMining(cur, s.mine_cap_hours, now);
      cur.balance -= plan.price;
      spend(cur, "boosts", plan.price);
      cur.boosts = cur.boosts || {};
      cur.boosts[id] = {
        name: plan.name,
        bought_at: now,
        expires_at: plan.duration_days > 0 ? now + plan.duration_days * 86400000 : 0,
        tap: plan.tap_bonus || 0,
        en: plan.energy_bonus || 0,
        regen: plan.regen_bonus || 0,
        mph: plan.mine_per_hour || 0,
      };
      out = { balance: cur.balance, collected };
      return cur;
    });
  if (err) throw new HttpError(409, err);
  await activity(user.id, "boost", { coins: -plan.price, note: String(plan.name).slice(0, 40) });
  res.json({ success: true, ...out });
});
