import { authenticate } from "@/lib/auth";
import { route } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ensureUser, currentEnergy, effective, settleCommission } from "@/lib/user";
import { ArticleSite, Run } from "@/lib/chain";
import { peekPrice } from "@/lib/market";
import { dayKey } from "@/lib/log";

/** Mini App খুললে প্রথম call: user state + task + article card + চলমান run + withdraw ইতিহাস (গোপন কিছু ছাড়া) */
export default route(async (req, res) => {
  const user = authenticate(req);
  const { u, settings } = await ensureUser(user, { soft: true, touch: true });
  const now = Date.now();
  if (u.ref_count) { const g = await settleCommission(user.id); if (g) u.balance += g; }

  const cfg = {
    minWithdraw: settings.min_withdraw,
    methods: settings.withdraw_methods,
    coinsPerUnit: settings.coins_per_unit,
    unitLabel: settings.unit_label,
    withdrawEnabled: settings.withdraw_enabled,
    earnPerTap: settings.earn_per_tap,
    coinsPerTfuel: settings.coins_per_tfuel,
  };
  const announcement =
    settings.announcement.enabled && settings.announcement.text ? settings.announcement : null;

  if (u.banned) return void res.json({ success: true, banned: true, cfg });
  if (settings.maintenance) {
    return void res.json({ success: true, maintenance: true, message: settings.maintenance_msg, cfg });
  }

  const [tSnap, sSnap] = await Promise.all([db().ref("tasks").get(), db().ref("article_sites").get()]);

  const tasks = Object.entries((tSnap.val() || {}) as Record<string, any>).map(([id, t]) => ({
    id,
    type: t.type,
    title: t.title,
    url:
      t.url ||
      (t.type === "telegram_join" && String(t.channel_id || "").startsWith("@")
        ? `https://t.me/${String(t.channel_id).slice(1)}`
        : undefined),
    reward: t.reward,
    min_wait_seconds: t.min_wait_seconds,
    channel_id: t.type === "telegram_join" ? t.channel_id : undefined,
    done: !!u.completed_tasks?.[id]?.claimed,
  }));

  // চলমান run
  let run: { site_id: string; step_done: number; total: number; status: string } | null = null;
  if (u.active_run) {
    const r = (await db().ref(`runs/${u.active_run}`).get()).val() as Run | null;
    if (r && r.uid === user.id && (r.status === "running" || r.status === "code_issued") && r.expires_at > now) {
      run = { site_id: r.site_id, step_done: r.step_done, total: r.total, status: r.status };
    }
  }

  // Article Site কার্ড (Tasks ট্যাবে দেখানো হয়)
  const sites = Object.entries((sSnap.val() || {}) as Record<string, ArticleSite>)
    .filter(([, s]) => s.is_active && s.urls?.length)
    .map(([id, s]) => ({
      id,
      name: s.name,
      reward: s.reward,
      cooldown_minutes: s.cooldown_minutes,
      total: s.urls.length,
      ready_at: Math.max(0, (u.completed_tasks?.[id]?.claimed_at || 0) + s.cooldown_minutes * 60000),
      in_progress: run?.site_id === id,
    }))
    .sort((a, b) => Number(a.ready_at > now) - Number(b.ready_at > now) || a.name.localeCompare(b.name));

  const withdrawals = Object.entries(u.withdrawals || {})
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 20)
    .map(([id, w]) => ({ id, amount: w.amount, method: w.method, status: w.status, created_at: w.created_at }));

  const eff = effective(u, settings, now);
  const en = currentEnergy(eff, now, settings.empty_refill_hours);
  let refillAt: number | null = null;
  if (en < settings.energy_cost && settings.empty_refill_hours > 0) {
    let at = u.empty_at || 0;
    if (!at) {
      at = now; // energy খালি কিন্তু সময় শুরু হয়নি (যেমন admin cost বাড়িয়েছে) — এখন শুরু
      await db().ref(`users/${user.id}/empty_at`).set(at).catch(() => {});
    }
    refillAt = at + settings.empty_refill_hours * 3600000;
  }
  const price = await peekPrice(settings);
  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.first_name,
      balance: u.balance,
      energy: Math.round(en * 100) / 100,
      energyCost: settings.energy_cost,
      refillAt,
      refillHours: settings.empty_refill_hours,
      maxEnergy: eff.max_energy,
      regen: eff.energy_regen_rate,
      perTap: eff.earn_per_tap,
    },
    tasks,
    sites,
    run,
    withdrawals,
    announcement,
    price,
    dailyReady: settings.daily_enabled && u.daily?.day !== dayKey(now),
    cfg,
  });
});
