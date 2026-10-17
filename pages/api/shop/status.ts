import { wrapShop, Order } from "@/lib/shop";
import { db } from "@/lib/firebase";
import { HttpError } from "@/lib/auth";
import { fromU } from "@/lib/market";

export const config = { api: { bodyParser: false } };

/** shop সার্ভার: order_id বা ref দিয়ে অবস্থা দেখে (webhook না পেলে polling) */
export default wrapShop(async ({ id, body }, res) => {
  let oid = String(body.order_id || "");
  if (!oid && body.ref) oid = String((await db().ref(`shop_orders_ref/${id}/${String(body.ref)}`).get()).val() || "");
  if (!/^[\w-]{1,64}$/.test(oid)) throw new HttpError(404, "order_not_found");
  const o = (await db().ref(`shop_orders/${oid}`).get()).val() as Order | null;
  if (!o || o.shop !== id) throw new HttpError(404, "order_not_found");
  const status = o.status === "open" && o.exp < Date.now() ? "expired" : o.status === "paying" ? "open" : o.status;
  res.json({ success: true, order_id: oid, ref: o.ref, status, usd: fromU(o.usd_u), currency: o.cur || null, paid_usdt: o.cur === "usdt" ? fromU(o.usdt_u || 0) : null, paid_coins: o.cur === "tfuel" ? o.coins : null, user_id: o.paid_by || null, paid_at: o.paid_at || null });
});
