import { authenticate, HttpError, } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ServerValue } from "firebase-admin/database";
import { sortableId } from "@/lib/crypto";
import { ensureUser, newUser, MAX_AUTH_AGE_MONEY, UserRecord } from "@/lib/user";
import { getPrice, toU, fromU, U } from "@/lib/market";
import { padPrice, idxPath, Order } from "@/lib/orders";

/**
 * Limit order (auto buy / sell): action = list | place | cancel
 *  sell: amount = TFUEL পরিমাণ, limit = এই দাম বা তার ওপরে বেচবে (coin আগেই আলাদা করে রাখা হয়)
 *  buy : amount = USDT, limit = এই দাম বা তার নিচে কিনবে (USDT আগেই আলাদা করে রাখা হয়)
 * দাম ছুঁলে server নিজে পূরণ করে (বাজার-দামে, fee সহ)।
 */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "orders", 20);
  const { settings: s } = await ensureUser(user);
  const action = String(req.body?.action || "list");

  const list = async () =>
    Object.entries(((await db().ref(`users/${user.id}/orders`).get()).val() || {}) as Record<string, any>)
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .slice(0, 20)
      .map(([id, o]) => ({ id, side: o.side, coins: o.coins, usdt: fromU(o.spend_u || 0), limit: o.limit, status: o.status, price: o.price || null, at: o.at }));

  if (action === "list") return void res.json({ success: true, orders: await list(), max: s.max_open_orders });
  if (!s.orders_enabled || !s.trade_enabled) throw new HttpError(403, "orders_disabled");

  if (action === "place") {
    const side = String(req.body?.side || "");
    if (side !== "buy" && side !== "sell") throw new HttpError(400, "bad_side");
    if ((side === "buy" && !s.buy_enabled) || (side === "sell" && !s.sell_enabled)) throw new HttpError(403, "trade_side_disabled");
    const p = await getPrice(s);
    if (!p || p.stale) throw new HttpError(503, "price_unavailable");
    const limit = Number(req.body?.limit);
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(limit) || limit <= 0 || limit > 1e6 || !Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "bad_amount");
    if (side === "sell" && limit <= p.price) throw new HttpError(400, "limit_wrong_side");
    if (side === "buy" && limit >= p.price) throw new HttpError(400, "limit_wrong_side");

    const coins = side === "sell" ? Math.floor(amount * s.coins_per_tfuel) : 0;
    const spend_u = side === "buy" ? toU(amount) : 0;
    const gross_u = side === "sell" ? Math.round((coins / s.coins_per_tfuel) * limit * U) : spend_u;
    if (gross_u < toU(s.min_trade_usdt)) throw new HttpError(400, "below_min_trade");
    if (gross_u > toU(s.max_trade_usdt)) throw new HttpError(400, "above_max_trade");
    if (side === "sell" && coins < 1) throw new HttpError(400, "bad_amount");

    const id = sortableId();
    const now = Date.now();
    let err = "";
    await db()
      .ref(`users/${user.id}`)
      .transaction((cur: UserRecord | null) => {
        err = "";
        if (cur === null) return newUser();
        if ((cur.ord_open || 0) >= s.max_open_orders) {
          err = "orders_full";
          return;
        }
        if (side === "sell") {
          if (cur.balance < coins) {
            err = "insufficient";
            return;
          }
          cur.balance -= coins;
        } else {
          if ((cur.usdt_u || 0) < spend_u) {
            err = "insufficient_usdt";
            return;
          }
          cur.usdt_u = (cur.usdt_u || 0) - spend_u;
        }
        cur.ord_open = (cur.ord_open || 0) + 1;
        cur.orders = cur.orders || {};
        cur.orders[id] = { side, coins, spend_u, limit, status: "open", at: now };
        const ks = Object.keys(cur.orders).sort();
        while (ks.length > 40) {
          const k = ks.shift()!;
          if (cur.orders[k].status !== "open") delete cur.orders[k];
          else break;
        }
        return cur;
      });
    if (err) throw new HttpError(409, err);
    const ord: Order = { uid: user.id, side, coins, spend_u, limit, status: "open", at: now };
    await db()
      .ref()
      .update({ [`orders/${id}`]: ord, [`${idxPath(side)}/${padPrice(limit)}_${id}`]: { id } });
    return void res.json({ success: true, id, orders: await list() });
  }

  if (action === "cancel") {
    const id = String(req.body?.id || "");
    if (!/^[\w-]{1,64}$/.test(id)) throw new HttpError(400, "bad_id");
    let o: Order | null = null;
    await db()
      .ref(`orders/${id}`)
      .transaction((cur: Order | null) => {
        o = null;
        if (cur === null) return cur;
        if (cur.uid !== user.id || cur.status !== "open") return;
        cur.status = "cancelled";
        o = { ...cur };
        return cur;
      });
    if (!o) throw new HttpError(409, "order_not_open");
    const ord = o as Order;
    const up: Record<string, any> = {
      [`${idxPath(ord.side)}/${padPrice(ord.limit)}_${id}`]: null,
      [`users/${user.id}/ord_open`]: ServerValue.increment(-1),
      [`users/${user.id}/orders/${id}/status`]: "cancelled",
    };
    if (ord.side === "sell") up[`users/${user.id}/balance`] = ServerValue.increment(ord.coins);
    else up[`users/${user.id}/usdt_u`] = ServerValue.increment(ord.spend_u);
    await db().ref().update(up);
    return void res.json({ success: true, orders: await list() });
  }
  throw new HttpError(400, "bad_action");
});
