import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { sortableId } from "@/lib/crypto";
import { ensureUser } from "@/lib/user";
import { peekPrice } from "@/lib/market";
import { padPrice } from "@/lib/orders";

/** Price alert: action = list | add {price} | remove {id}. Telegram bot-এ বার্তা যায় (অবস্থা: bot চালু থাকতে হবে) */
export default route(async (req, res) => {
  const user = authenticate(req);
  await rateLimit(user.id, "alerts", 20);
  const { u, settings: s } = await ensureUser(user);
  const action = String(req.body?.action || "list");
  const list = async () =>
    Object.entries(((await db().ref(`users/${user.id}/alerts`).get()).val() || {}) as Record<string, any>)
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([id, a]) => ({ id, price: a.price, dir: a.dir, at: a.at }));

  if (action === "list") return void res.json({ success: true, alerts: await list(), max: s.max_alerts });

  if (action === "add") {
    const price = Number(req.body?.price);
    if (!Number.isFinite(price) || price <= 0 || price > 1e6) throw new HttpError(400, "bad_price");
    const cur = await peekPrice(s);
    if (!cur) throw new HttpError(503, "price_unavailable");
    if (Math.abs(price / cur - 1) < 0.0005) throw new HttpError(400, "alert_too_close");
    const dir = price > cur ? "above" : "below";
    const existing = await list();
    if (existing.length >= s.max_alerts) throw new HttpError(409, "alerts_full");
    const id = sortableId();
    await db()
      .ref()
      .update({
        [`users/${user.id}/alerts/${id}`]: { price, dir, at: Date.now() },
        [`alert_${dir}/${padPrice(price)}_${id}`]: { uid: user.id, id },
      });
    return void res.json({ success: true, id, dir, alerts: await list() });
  }

  if (action === "remove") {
    const id = String(req.body?.id || "");
    if (!/^[\w-]{1,64}$/.test(id)) throw new HttpError(400, "bad_id");
    const a = (await db().ref(`users/${user.id}/alerts/${id}`).get()).val();
    if (a) await db().ref().update({ [`users/${user.id}/alerts/${id}`]: null, [`alert_${a.dir}/${padPrice(a.price)}_${id}`]: null });
    return void res.json({ success: true, alerts: await list() });
  }
  throw new HttpError(400, "bad_action");
});
