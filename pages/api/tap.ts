import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { flag } from "@/lib/log";
import { enqueue } from "@/lib/queue";
import { earn, lbAdd } from "@/lib/wallet";
import {
  ensureUser,
  currentEnergy,
  effective,
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

  const { settings } = await ensureUser(user);

  let failure: string | null = null;
  let earnedTap = 0;
  let accepted = 0;
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

      const eff = effective(cur, settings, now);
      const cost = settings.energy_cost;
      const rh = settings.empty_refill_hours;
      const energy = currentEnergy(eff, now, rh);
      cur.max_energy = eff.max_energy;
      cur.energy_regen_rate = eff.energy_regen_rate;
      cur.earn_per_tap = eff.earn_per_tap;
      if (energy >= cost) cur.empty_at = null;

      // energy যতটা পারে তত tap গ্রহণ (পুরো batch বাতিল নয়)
      const n = Math.min(tapCount, Math.floor((energy + 1e-9) / cost));
      accepted = n;
      cur.energy = energy - n * cost;
      cur.last_energy_calc_time = now;
      if (n < 1) {
        // খালি: সময় শুরু করে রাখি (commit করি), তারপর client-কে জানাই
        if (rh > 0 && !cur.empty_at) cur.empty_at = now;
        failure = "Not enough energy";
        return cur;
      }
      cur.last_tap_time = now;
      cur.balance += n * eff.earn_per_tap;
      earn(cur, "tap", n * eff.earn_per_tap);
      earnedTap = n * eff.earn_per_tap;
      if (cur.energy < cost && rh > 0 && !cur.empty_at) cur.empty_at = now;
      return cur;
    });

  if (failure === "Not enough energy") {
    const u0 = result.snapshot.val() as UserRecord;
    return void res.status(429).json({ success: false, error: failure, energy: Math.round(u0.energy * 100) / 100, refillAt: u0.empty_at && settings.empty_refill_hours > 0 ? u0.empty_at + settings.empty_refill_hours * 3600000 : null });
  }
  if (!result.committed) {
    if (failure === "Too fast") await flag(user.id, "too_fast");
    throw new HttpError(429, failure || "Rejected");
  }
  const u = result.snapshot.val() as UserRecord;
  await lbAdd(user.id, earnedTap);
  if (u.empty_at && u.energy < settings.energy_cost && settings.empty_refill_hours > 0)
    await enqueue("energy", u.empty_at + settings.empty_refill_hours * 3600000, user.id, { uid: user.id, ea: u.empty_at });
  res.json({
    success: true,
    accepted,
    balance: u.balance,
    energy: Math.round(u.energy * 100) / 100,
    maxEnergy: u.max_energy,
    refillAt: u.empty_at && u.energy < settings.energy_cost && settings.empty_refill_hours > 0 ? u.empty_at + settings.empty_refill_hours * 3600000 : null,
  });
});
