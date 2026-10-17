import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ensureUser, MAX_AUTH_AGE_MONEY } from "@/lib/user";
import { checkPin } from "@/lib/prefs";
import { getPrice, fromU } from "@/lib/market";
import { makeLoginCode, payOrder, quoteFor, Shop, Order } from "@/lib/shop";

/** Mini App-এর শপ অংশ: তালিকা / সংযোগ / লগইন-লিংক / পেমেন্ট */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "shop", 30);
  const { u, settings: s } = await ensureUser(user);
  const action = String(req.body?.action || "list");
  const sid = String(req.body?.shop || "");

  if (action === "list") {
    if (!s.shops_enabled) return void res.json({ success: true, enabled: false, shops: [], orders: [] });
    const all = ((await db().ref("shops").get()).val() || {}) as Record<string, Shop>;
    const links = ((await db().ref(`shop_links/${user.id}`).get()).val() || {}) as Record<string, any>;
    const mine = ((await db().ref(`user_shop/${user.id}`).get()).val() || {}) as Record<string, any>;
    return void res.json({
      success: true,
      enabled: true,
      shops: Object.entries(all).filter(([, x]) => x.enabled).map(([id, x]) => ({ id, name: x.name, domain: x.domain, tfuel: x.allow_tfuel, usdt: x.allow_usdt, connected: !!links[id] })),
      orders: Object.entries(mine).sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, 30).map(([id, o]) => ({ id, ...o, usd: fromU(o.usd_u), usdt: fromU(o.usdt_u || 0) })),
    });
  }

  if (action === "launch" || action === "disconnect") {
    if (!/^[\w-]{1,40}$/.test(sid)) throw new HttpError(400, "bad_request");
    const shop = (await db().ref(`shops/${sid}`).get()).val() as Shop | null;
    if (!shop || !shop.enabled || !s.shops_enabled) throw new HttpError(404, "shop_unavailable");
    if (action === "disconnect") {
      await db().ref(`shop_links/${user.id}/${sid}`).remove();
      return void res.json({ success: true });
    }
    const linked = (await db().ref(`shop_links/${user.id}/${sid}`).get()).exists();
    if (!linked) {
      if (!req.body?.consent) throw new HttpError(400, "shop_not_connected");
      await db().ref(`shop_links/${user.id}/${sid}`).set({ at: Date.now() });
    }
    const code = await makeLoginCode(user.id, sid);
    const base = shop.login_url || shop.domain;
    return void res.json({ success: true, url: `${base}${base.includes("?") ? "&" : "?"}code=${code}` });
  }

  if (action === "order" || action === "pay") {
    const oid = String(req.body?.id || "");
    if (!/^[\w-]{1,64}$/.test(oid)) throw new HttpError(404, "order_not_found");
    const o = (await db().ref(`shop_orders/${oid}`).get()).val() as Order | null;
    if (!o || (o.uid && o.uid !== user.id)) throw new HttpError(404, "order_not_found");
    const shop = (await db().ref(`shops/${o.shop}`).get()).val() as Shop | null;
    if (!shop || !shop.enabled || !s.shops_enabled) throw new HttpError(404, "shop_unavailable");

    if (action === "pay") {
      await rateLimit(user.id, "shop_pay", 8);
      const cur = req.body?.cur === "usdt" ? "usdt" : "tfuel";
      await checkPin(user.id, req.body?.pin);
      const r = await payOrder(user.id, user.first_name || "User", oid, cur);
      return void res.json({ success: true, status: "paid", return_url: o.return_url || shop.domain, shop: shop.name, cur, amount: r.amount });
    }

    const p = await getPrice(s);
    const q = quoteFor(o, p && !p.stale ? p.price : null, s.coins_per_tfuel);
    const pin = (await db().ref(`user_prefs/${user.id}/pin`).get()).exists();
    const pref = (await db().ref(`user_prefs/${user.id}/cur`).get()).val();
    const status = o.status === "open" && o.exp < Date.now() ? "expired" : o.status === "paying" ? "open" : o.status;
    return void res.json({
      success: true,
      order: { id: oid, shop: shop.name, title: o.title, usd: q.usd, status, exp: o.exp, return_url: o.return_url || shop.domain },
      pay: { tfuel: shop.allow_tfuel && q.tfuel_coins !== null ? { coins: q.tfuel_coins, balance: u.balance } : null, usdt: shop.allow_usdt ? { amount: q.usdt, balance: fromU(u.usdt_u || 0) } : null },
      pin,
      pref: pref === "usdt" ? "usdt" : "tfuel",
    });
  }
  throw new HttpError(400, "bad_request");
});
