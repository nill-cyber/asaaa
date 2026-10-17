import { wrapShop, refundOrder, Order } from "@/lib/shop";
import { db } from "@/lib/firebase";
import { HttpError } from "@/lib/auth";

export const config = { api: { bodyParser: false } };

/** shop সার্ভার: পূর্ণ refund (শুধু paid order, একবার) */
export default wrapShop(async ({ id, body }, res) => {
  const oid = String(body.order_id || "");
  if (!/^[\w-]{1,64}$/.test(oid)) throw new HttpError(404, "order_not_found");
  const o = (await db().ref(`shop_orders/${oid}`).get()).val() as Order | null;
  if (!o || o.shop !== id) throw new HttpError(404, "order_not_found");
  const r = await refundOrder(oid, "shop:" + id);
  res.json({ success: true, status: r.status });
});
