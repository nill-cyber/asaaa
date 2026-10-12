import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { activity, lbAdd } from "@/lib/wallet";
import { ensureUser, newUser, settleMining, MAX_AUTH_AGE_MONEY, UserRecord } from "@/lib/user";

export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "collect-mining", 20);
  const { settings: s } = await ensureUser(user);
  let amount = 0;
  let balance = 0;
  await db()
    .ref(`users/${user.id}`)
    .transaction((cur: UserRecord | null) => {
      if (cur === null) return newUser();
      amount = settleMining(cur, s.mine_cap_hours);
      balance = cur.balance;
      return cur;
    });
  if (amount < 1) throw new HttpError(409, "nothing_to_collect");
  await lbAdd(user.id, amount);
  await activity(user.id, "mining", { coins: amount, note: "Collected" });
  res.json({ success: true, amount, balance });
});
