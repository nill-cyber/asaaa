import { authenticate } from "@/lib/auth";
import { route } from "@/lib/api";
import { ensureUser } from "@/lib/user";
import { dayKey } from "@/lib/log";

/** Spin, Ads ও Notification-এর অবস্থা (Tasks / Boost ট্যাবের কার্ড) */
export default route(async (req, res) => {
  const user = authenticate(req);
  const { u, settings: s } = await ensureUser(user, { soft: true });
  const day = dayKey();
  const sp = u.spin?.day === day ? u.spin : { day, used: 0, extra: u.spin?.extra || 0 };
  const ad = u.ads?.day === day ? u.ads : { day, coins: 0, energy: 0, spin: 0 };
  const adsOn = s.ads_enabled && !!s.ads_block_id;
  res.json({
    success: true,
    spin: {
      enabled: s.spin_enabled,
      prizes: s.spin_prizes.map((p) => p.coins),
      free: Math.max(0, s.spin_free_per_day - (sp.used || 0)),
      extra: sp.extra || 0,
    },
    ads: {
      enabled: adsOn,
      blockId: adsOn ? s.ads_block_id : "",
      coins: s.ads_coins,
      coinsLeft: Math.max(0, s.ads_coins_per_day - (ad.coins || 0)),
      energyLeft: Math.max(0, s.ads_energy_per_day - (ad.energy || 0)),
      spinLeft: s.spin_enabled ? Math.max(0, s.ads_spin_per_day - (ad.spin || 0)) : 0,
    },
    notify: { available: s.notify_enabled, on: !u.notify_off },
    orders: { enabled: s.orders_enabled && s.trade_enabled, max: s.max_open_orders },
    alerts: { max: s.max_alerts },
  });
});
