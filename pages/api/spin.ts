import crypto from "crypto";
import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { dayKey } from "@/lib/log";
import { earn, activity, lbAdd } from "@/lib/wallet";
import { ensureUser, newUser, UserRecord } from "@/lib/user";

/** Lucky Spin: প্রথমে free, তারপর ad দেখে পাওয়া extra spin। পুরস্কার server ঠিক করে (weight অনুযায়ী)। */
export default route(async (req, res) => {
  const user = authenticate(req);
  await rateLimit(user.id, "spin", 20);
  const { settings: s } = await ensureUser(user);
  if (!s.spin_enabled) throw new HttpError(403, "spin_disabled");

  const total = s.spin_prizes.reduce((a, p) => a + p.weight, 0);
  let r = (crypto.randomInt(0, 1_000_000) / 1_000_000) * total;
  let idx = 0;
  for (let i = 0; i < s.spin_prizes.length; i++) {
    r -= s.spin_prizes[i].weight;
    if (r < 0) {
      idx = i;
      break;
    }
    idx = i;
  }
  const coins = s.spin_prizes[idx].coins;
  const day = dayKey();
  let err = "";
  let balance = 0;
  let left = { free: 0, extra: 0 };
  await db()
    .ref(`users/${user.id}`)
    .transaction((cur: UserRecord | null) => {
      err = "";
      if (cur === null) return newUser();
      const sp = cur.spin && cur.spin.day === day ? cur.spin : { day, used: 0, extra: cur.spin?.extra || 0 };
      if (sp.used < s.spin_free_per_day) sp.used += 1;
      else if (sp.extra > 0) sp.extra -= 1;
      else {
        err = "no_spins";
        return;
      }
      cur.spin = sp;
      cur.balance += coins;
      earn(cur, "spin", coins);
      balance = cur.balance;
      left = { free: Math.max(0, s.spin_free_per_day - sp.used), extra: sp.extra };
      return cur;
    });
  if (err) throw new HttpError(409, err);
  await lbAdd(user.id, coins);
  await activity(user.id, "spin", { coins, note: "Lucky Spin" });
  res.json({ success: true, index: idx, coins, balance, ...left });
});
