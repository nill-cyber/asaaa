import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ServerValue } from "firebase-admin/database";
import { sortableId } from "@/lib/crypto";
import { dayKey } from "@/lib/log";
import { earn, spend, usdtTot, activity } from "@/lib/wallet";
import { ensureUser, newUser, MAX_AUTH_AGE_MONEY, UserRecord } from "@/lib/user";
import { getPrice, toU, U } from "@/lib/market";

/**
 * Buy / Sell — বাজার-দামে। দাম সবসময় server ঠিক করে (client-এর দেখা দাম ১% এর বেশি আলাদা হলে প্রত্যাখ্যান)।
 *  sell: amount = coin   → USDT পায় (fee কেটে)
 *  buy : amount = USDT   → coin পায় (fee কেটে)
 */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "trade", 20);
  const { settings: s } = await ensureUser(user);

  const side = String(req.body?.side || "");
  if (side !== "buy" && side !== "sell") throw new HttpError(400, "bad_side");
  if (!s.trade_enabled) throw new HttpError(403, "trade_disabled");
  if ((side === "buy" && !s.buy_enabled) || (side === "sell" && !s.sell_enabled)) throw new HttpError(403, "trade_side_disabled");

  const p = await getPrice(s);
  if (!p || p.stale) throw new HttpError(503, "price_unavailable");
  const seen = Number(req.body?.price_seen);
  if (seen > 0 && Math.abs(p.price / seen - 1) > 0.01) {
    return void res.status(409).json({ success: false, error: "price_changed", price: p.price });
  }

  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "bad_amount");

  const fee = s.trade_fee_pct / 100;
  let coins = 0; // coin-এর পরিমাণ (দুই দিকেই)
  let gross_u = 0; // বাজারমূল্য, micro-USDT
  let fee_u = 0;
  let usdtDelta = 0; // user-এর USDT বদল (+/-)
  let coinDelta = 0;

  if (side === "sell") {
    coins = Math.floor(amount);
    gross_u = Math.round((coins / s.coins_per_tfuel) * p.price * U);
    fee_u = Math.floor(gross_u * fee);
    usdtDelta = gross_u - fee_u;
    coinDelta = -coins;
  } else {
    const spend_u = toU(amount);
    fee_u = Math.floor(spend_u * fee);
    gross_u = spend_u;
    coins = Math.floor(((spend_u - fee_u) / U / p.price) * s.coins_per_tfuel);
    usdtDelta = -spend_u;
    coinDelta = coins;
  }
  if (coins < 1 || gross_u < 1) throw new HttpError(400, "bad_amount");
  if (gross_u < toU(s.min_trade_usdt)) throw new HttpError(400, "below_min_trade");
  if (gross_u > toU(s.max_trade_usdt)) throw new HttpError(400, "above_max_trade");

  const id = sortableId();
  const now = Date.now();
  const day = dayKey(now);
  let err = "";
  let out: { balance: number; usdt_u: number } | null = null;
  const result = await db()
    .ref(`users/${user.id}`)
    .transaction((cur: UserRecord | null) => {
      err = "";
      if (cur === null) return newUser();
      const used = cur.trade_day?.day === day ? cur.trade_day.u : 0;
      if (s.daily_trade_limit_usdt > 0 && used + gross_u > toU(s.daily_trade_limit_usdt)) {
        err = "daily_trade_limit";
        return;
      }
      if ((cur.balance || 0) + coinDelta < 0) {
        err = "insufficient";
        return;
      }
      if ((cur.usdt_u || 0) + usdtDelta < 0) {
        err = "insufficient_usdt";
        return;
      }
      cur.balance += coinDelta;
      if (side === "sell") { spend(cur, "sold", coins); usdtTot(cur, "sold", usdtDelta); } else { earn(cur, "bought", coins); usdtTot(cur, "bought", -usdtDelta); }
      cur.usdt_u = (cur.usdt_u || 0) + usdtDelta;
      cur.trade_day = { day, u: used + gross_u };
      const t: Record<string, any> = ((cur as any).trades = (cur as any).trades || {});
      t[id] = { side, coins, usdt_u: Math.abs(usdtDelta), fee_u, price: p.price, at: now };
      const keys = Object.keys(t).sort();
      while (keys.length > 30) delete t[keys.shift()!];
      out = { balance: cur.balance, usdt_u: cur.usdt_u };
      return cur;
    });
  if (!result.committed || err) throw new HttpError(409, err || "trade_failed");

  await db()
    .ref()
    .update({
      [`trades/${id}`]: { uid: user.id, side, coins, usdt_u: Math.abs(usdtDelta), fee_u, price: p.price, at: now },
      "stats/trade_volume_u": ServerValue.increment(gross_u),
      "stats/trade_fees_u": ServerValue.increment(fee_u),
    })
    .catch(() => {});

  await activity(user.id, side, { coins: coinDelta, usdt_u: usdtDelta, note: `@ $${p.price}` });
  const o = out as unknown as { balance: number; usdt_u: number };
  res.json({ success: true, side, coins, usdt: Math.abs(usdtDelta) / U, fee: fee_u / U, price: p.price, balance: o.balance, usdtBalance: o.usdt_u / U });
});
