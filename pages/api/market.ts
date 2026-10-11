import { authenticate } from "@/lib/auth";
import { route } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ensureUser } from "@/lib/user";
import { getPrice, fromU } from "@/lib/market";

const last = (o: Record<string, any> | undefined, n = 20) =>
  Object.entries(o || {})
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, n)
    .map(([id, v]) => ({ id, ...v }));

/** TFUEL ট্যাব: দাম, সীমা, ব্যালেন্স, নেটওয়ার্ক ও ইতিহাস */
export default route(async (req, res) => {
  const user = authenticate(req);
  const { u, settings: s } = await ensureUser(user);
  const p = await getPrice(s);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const dep = ((await db().ref(`users/${user.id}/deposits`).get()).val() || {}) as Record<string, any>;
  const pay = ((await db().ref(`users/${user.id}/usdt_withdrawals`).get()).val() || {}) as Record<string, any>;

  res.json({
    success: true,
    price: p ? { value: p.price, stale: p.stale, at: p.at } : null,
    trade: {
      enabled: s.trade_enabled && !!p && !p.stale,
      paused: !s.trade_enabled ? "off" : !p ? "no_price" : p.stale ? "stale" : null,
      buy: s.buy_enabled,
      sell: s.sell_enabled,
      feePct: s.trade_fee_pct,
      min: s.min_trade_usdt,
      max: s.max_trade_usdt,
      dailyLimit: s.daily_trade_limit_usdt,
      usedToday: u.trade_day?.day === today ? fromU(u.trade_day.u) : 0,
      coinsPerTfuel: s.coins_per_tfuel,
    },
    balances: { coins: u.balance, usdt: fromU(u.usdt_u || 0) },
    deposit: {
      enabled: s.deposit_enabled,
      networks: s.deposit_networks.map((n) => ({ id: n.id, name: n.name, address: n.address, min: n.min, note: n.note })),
    },
    payout: {
      enabled: s.payout_enabled,
      networks: s.payout_networks.map((n) => ({ id: n.id, name: n.name, min: n.min, fee: n.fee })),
    },
    trades: last((u as any).trades),
    deposits: last(dep),
    payouts: last(pay),
  });
});
