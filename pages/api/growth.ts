import { authenticate } from "@/lib/auth";
import { route } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ensureUser, boostActive, pendingMining } from "@/lib/user";
import { dayKey } from "@/lib/log";

/** Boost, Staking, Daily reward, Referral — Boost ট্যাবের সব তথ্য একসাথে */
export default route(async (req, res) => {
  const user = authenticate(req);
  const { u, settings: s } = await ensureUser(user);
  const now = Date.now();
  const [bp, sp, refs, pools] = await Promise.all([
    db().ref("boost_plans").get(),
    db().ref("stake_plans").get(),
    db().ref(`referrals/${user.id}`).get(),
    db().ref("stake_pools").get(),
  ]);
  const poolUsed = (pools.val() || {}) as Record<string, number>;

  const boosts = Object.entries((bp.val() || {}) as Record<string, any>)
    .filter(([, p]) => p.is_active)
    .map(([id, p]) => {
      const mine = u.boosts?.[id];
      return {
        id, name: p.name, price: p.price, tap: p.tap_bonus, en: p.energy_bonus, regen: p.regen_bonus, mph: p.mine_per_hour, days: p.duration_days,
        active: !!mine && boostActive(mine, now), expires_at: mine?.expires_at || 0,
      };
    })
    .sort((a, b) => a.price - b.price);

  const plans = Object.entries((sp.val() || {}) as Record<string, any>)
    .filter(([, p]) => p.is_active)
    .map(([id, p]) => ({
      id, name: p.name, days: p.days, pct: p.reward_pct, min: p.min, max: p.max,
      left: p.pool_cap > 0 ? Math.max(0, p.pool_cap - (poolUsed[id] || 0)) : null,
    }))
    .sort((a, b) => a.days - b.days);

  const stakes = Object.entries(u.stakes || {})
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 30)
    .map(([id, k]) => ({ id, ...k, ready: k.status === "active" && k.end <= now }));

  const m = pendingMining(u, s.mine_cap_hours, now);
  const today = dayKey(now);
  const yesterday = dayKey(now - 86400000);
  const d = u.daily;
  const claimedToday = d?.day === today;
  const streak = claimedToday ? d!.streak : d?.day === yesterday ? d.streak : 0;
  const nextIdx = claimedToday ? d!.streak % s.daily_rewards.length : streak % s.daily_rewards.length;

  const refList = Object.entries((refs.val() || {}) as Record<string, any>)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, 20)
    .map(([id, r]) => ({ id, name: r.name, at: r.at, bonus: r.bonus }));

  res.json({
    success: true,
    boosts: { plans: boosts, mining: { pending: m.amount, perHour: m.perHour, capHours: s.mine_cap_hours } },
    staking: { plans, stakes },
    daily: { enabled: s.daily_enabled, claimedToday, streak, rewards: s.daily_rewards, nextIndex: nextIdx },
    referral: {
      enabled: s.referral_enabled,
      link: s.referral_link ? `${s.referral_link}?startapp=ref_${user.id}` : "",
      referrerBonus: s.referrer_bonus,
      inviteeBonus: s.invitee_bonus,
      count: u.ref_count || 0,
      earned: u.ref_earned || 0,
      pending: !!u.referred_by && !u.ref_paid,
      list: refList,
    },
  });
});
