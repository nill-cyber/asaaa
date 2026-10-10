import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import {
  ensureUser,
  currentEnergy,
  newUser,
  UserRecord,
  MAX_BATCH_LIMIT,
  MAX_TAPS_PER_SEC,
} from "@/lib/user";

export default route(async (req, res) => {
  const user = authenticate(req);
  await rateLimit(user.id, "tap", 120);

  // client-এর batchDurationMs ইচ্ছাকৃতভাবে উপেক্ষা করা হয়: সময় server নিজেই মাপে
  const tapCount = Math.floor(Number(req.body?.tapCount));
  if (!Number.isFinite(tapCount) || tapCount < 1 || tapCount > MAX_BATCH_LIMIT) {
    throw new HttpError(400, "Invalid tapCount");
  }

  await ensureUser(user.id);

  let failure: string | null = null;
  const result = await db()
    .ref(`users/${user.id}`)
    .transaction((cur: UserRecord | null) => {
      if (cur === null) return newUser(); // cache miss: retry জোর করে
      failure = null;
      const now = Date.now();

      // শেষ tap থেকে server-মাপা সময়ের ভিত্তিতে অনুমোদিত tap সংখ্যা
      const sinceLastSec = cur.last_tap_time
        ? Math.min(10, Math.max(0, (now - cur.last_tap_time) / 1000))
        : 1;
      const allowed = Math.ceil(sinceLastSec * MAX_TAPS_PER_SEC);
      if (tapCount > allowed) {
        failure = "Too fast";
        return; // abort
      }

      const energy = currentEnergy(cur, now);
      if (tapCount > energy) {
        failure = "Not enough energy";
        return;
      }

      cur.energy = energy - tapCount;
      cur.last_energy_calc_time = now;
      cur.last_tap_time = now;
      cur.balance += tapCount * (cur.earn_per_tap || 1);
      return cur;
    });

  if (!result.committed) throw new HttpError(429, failure || "Rejected");
  const u = result.snapshot.val() as UserRecord;
  res.json({ success: true, balance: u.balance, energy: Math.floor(u.energy), maxEnergy: u.max_energy });
});
