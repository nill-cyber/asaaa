import { wrapShop, newOrderId, ORDER_TTL_MS, Order } from "@/lib/shop";
import { db } from "@/lib/firebase";
import { HttpError } from "@/lib/auth";
import { toU, fromU } from "@/lib/market";

export const config = { api: { bodyParser: false } };

/** shop সার্ভার: নতুন পেমেন্ট অনুরোধ → user-কে পাঠানোর pay_url (একই ref দিলে একই order ফেরত) */
export default wrapShop(async ({ id, shop, body, s }, res) => {
  const ref = String(body.ref || "");
  const usd = Number(body.amount);
  const title = String(body.title || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80);
  if (!/^[\w.-]{1,64}$/.test(ref)) throw new HttpError(400, "bad_ref");
  if (!Number.isFinite(usd) || usd < 0.01 || usd > shop.max_usd) throw new HttpError(400, "bad_amount");
  const uid = body.user_id === undefined || body.user_id === null ? undefined : String(body.user_id);
  if (uid !== undefined && !/^\d{1,20}$/.test(uid)) throw new HttpError(400, "bad_user");
  let ret = String(body.return_url || "");
  if (ret && !ret.startsWith(shop.domain + "/") && ret !== shop.domain) throw new HttpError(400, "bad_return_url");
  if (!s.referral_link) throw new HttpError(503, "app_link_not_set");
  if (uid && !(await db().ref(`shop_links/${uid}/${id}`).get()).exists()) throw new HttpError(403, "not_connected");

  const now = Date.now();
  const oid = newOrderId();
  const claim = await db().ref(`shop_orders_ref/${id}/${ref}`).transaction((c: any) => (c === null ? oid : undefined));
  let orderId = oid;
  if (!claim.committed) {
    orderId = String((await db().ref(`shop_orders_ref/${id}/${ref}`).get()).val());
    const ex = (await db().ref(`shop_orders/${orderId}`).get()).val() as Order | null;
    if (ex && Math.abs(ex.usd_u - toU(usd)) > 0) throw new HttpError(409, "ref_conflict");
    if (ex && ex.status === "open" && ex.exp < now) { // পুরনো মেয়াদোত্তীর্ণ হলে নতুন সময় দিই
      await db().ref(`shop_orders/${orderId}`).update({ exp: now + ORDER_TTL_MS });
    }
    const cur = (await db().ref(`shop_orders/${orderId}`).get()).val() as Order;
    return void res.json({ success: true, order_id: orderId, status: cur.status, pay_url: `${s.referral_link}?startapp=pay_${orderId}`, expires_at: cur.exp });
  }
  const o: Order = { shop: id, ref, usd_u: toU(usd), title, status: "open", created_at: now, exp: now + ORDER_TTL_MS, ...(uid ? { uid } : {}), ...(ret ? { return_url: ret } : {}) };
  await db().ref(`shop_orders/${orderId}`).set(o);
  res.json({ success: true, order_id: orderId, status: "open", pay_url: `${s.referral_link}?startapp=pay_${orderId}`, expires_at: o.exp, usd: fromU(o.usd_u) });
});
