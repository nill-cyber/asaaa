import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { dayKey } from "@/lib/log";
import { ensureUser, newUser, MAX_AUTH_AGE_MONEY, UserRecord } from "@/lib/user";

/** প্রতিদিন (UTC) একবার; পরপর দিনে streak বাড়ে, একদিন বাদ গেলে ১ থেকে শুরু */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "claim-daily", 10);
  const { settings: s } = await ensureUser(user);
  if (!s.daily_enabled) throw new HttpError(403, "daily_disabled");
  const now = Date.now();
  const today = dayKey(now);
  const yesterday = dayKey(now - 86400000);

  let err = "";
  let out = { reward: 0, streak: 0, balance: 0 };
  await db()
    .ref(`users/${user.id}`)
    .transaction((cur: UserRecord | null) => {
      err = "";
      if (cur === null) return newUser();
      if (cur.daily?.day === today) {
        err = "already_claimed_today";
        return;
      }
      const streak = cur.daily?.day === yesterday ? cur.daily.streak + 1 : 1;
      const reward = s.daily_rewards[(streak - 1) % s.daily_rewards.length] || 0;
      cur.daily = { day: today, streak };
      cur.balance += reward;
      out = { reward, streak, balance: cur.balance };
      return cur;
    });
  if (err) throw new HttpError(409, err);
  res.json({ success: true, ...out });
});
