import type { NextApiRequest, NextApiResponse } from "next";
import { ServerValue } from "firebase-admin/database";
import { db } from "@/lib/firebase";
import { sha256, sortableId } from "@/lib/crypto";
import { tgCall, webhookSecret } from "@/lib/telegram";
import { notify } from "@/lib/notify";
import { activity } from "@/lib/wallet";
import { adminLog } from "@/lib/log";
import { fromU } from "@/lib/market";
import { getSettings } from "@/lib/settings";

/** Telegram → bot webhook: Stars পেমেন্ট (pre_checkout_query + successful_payment) ও /start */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return void res.status(405).end();
  if (!process.env.BOT_TOKEN || req.headers["x-telegram-bot-api-secret-token"] !== webhookSecret()) return void res.status(401).end();
  const u = req.body || {};
  try {
    if (u.pre_checkout_query) {
      const q = u.pre_checkout_query;
      const o = (await db().ref(`stars_orders/${String(q.invoice_payload || "")}`).get()).val();
      const ok = q.currency === "XTR" && o && o.status === "open" && String(o.uid) === String(q.from?.id) && Number(q.total_amount) === o.stars && (await getSettings()).stars_enabled;
      await tgCall("answerPreCheckoutQuery", ok ? { pre_checkout_query_id: q.id, ok: "true" } : { pre_checkout_query_id: q.id, ok: "false", error_message: "This payment is no longer valid. Please start again." });
    } else if (u.message?.successful_payment) {
      await creditStars(u.message.from?.id, u.message.successful_payment);
    } else if (u.message?.text && /^\/start/.test(u.message.text)) {
      const link = (await getSettings()).referral_link;
      await tgCall("sendMessage", link ? { chat_id: u.message.chat.id, text: "Welcome! Tap the button to open the app.", reply_markup: JSON.stringify({ inline_keyboard: [[{ text: "Open app", url: link }]] }) } : { chat_id: u.message.chat.id, text: "Welcome!" });
    }
  } catch (e) {
    console.error("tg-webhook", e);
    return void res.status(500).end(); // Telegram আবার পাঠাবে; credit idempotent
  }
  res.json({ ok: true });
}

/** একই পেমেন্ট দুইবার credit হয় না (charge id + order transaction) */
export async function creditStars(fromId: any, p: any) {
  const oid = String(p.invoice_payload || "");
  const charge = String(p.telegram_payment_charge_id || "");
  if (!oid || !charge || p.currency !== "XTR") return;
  let o: any = null;
  const r = await db().ref(`stars_orders/${oid}`).transaction((c: any) => {
    o = null;
    if (!c || c.status !== "open" || String(c.uid) !== String(fromId) || Number(p.total_amount) !== c.stars) return;
    c.status = "paid"; c.charge = charge; c.paid_at = Date.now();
    o = { ...c };
    return c;
  });
  if (!r.committed || !o) return;
  const key = sha256("stars:" + charge);
  const m = await db().ref(`deposit_credited/${key}`).transaction((x: any) => (x === null ? oid : undefined));
  if (!m.committed) return;
  const id = sortableId();
  const usdt = fromU(o.usdt_u);
  const rec = { network: "stars", network_name: "Telegram Stars", method: "stars", txid: "stars:" + charge, amount: usdt, stars: o.stars, status: "approved", credited: usdt, created_at: Date.now(), handled_at: Date.now(), note: `${o.stars} Stars`, by: "stars" };
  await db().ref().update({
    [`deposits/${id}`]: { ...rec, uid: String(o.uid), name: "" },
    [`users/${o.uid}/deposits/${id}`]: rec,
    [`users/${o.uid}/usdt_u`]: ServerValue.increment(o.usdt_u),
    [`users/${o.uid}/usdt_tot/deposited`]: ServerValue.increment(o.usdt_u),
  });
  await activity(String(o.uid), "deposit", { usdt_u: o.usdt_u, note: `${o.stars} Stars` });
  await notify(String(o.uid), `✅ ${o.stars} Stars received: +${usdt} USDT added to your wallet.`);
  await adminLog("stars", "stars_deposit", { uid: o.uid, stars: o.stars, usdt, charge });
}
