import { db } from "./firebase";
import { getSettings } from "./settings";
import { padPrice, fillOrder } from "./orders";
import { drain } from "./queue";
import { notify } from "./notify";

const LOCK_MS = 15000;

/**
 * দাম বদলালে/cron চললে: price alert, limit order, energy/stake বার্তা।
 * একই সময়ে একটাই চলে (locks/triggers)। বেশি কাজ থাকলে পরের বারে বাকিটা।
 */
export async function processTriggers(price: number | null, now = Date.now()) {
  const out = { alerts: 0, orders: 0, energy: 0, stake: 0 };
  let got = false;
  await db()
    .ref("locks/triggers")
    .transaction((cur: number | null) => {
      got = false;
      if (cur !== null && now - cur < LOCK_MS) return;
      got = true;
      return now;
    });
  if (!got) return out;
  try {
    const s = await getSettings();
    if (price && price > 0) {
      const pp = padPrice(price);
      // ---- price alerts ----
      for (const [path, snap] of [
        ["alert_above", await db().ref("alert_above").orderByKey().endAt(pp + "~").limitToFirst(50).get()],
        ["alert_below", await db().ref("alert_below").orderByKey().startAt(pp).limitToFirst(50).get()],
      ] as const) {
        const v = (snap.val() || {}) as Record<string, any>;
        for (const [k, a] of Object.entries(v)) {
          // alert_below: startAt(pp) = limit ≥ দাম (দাম limit-এ নেমেছে)
          if (path === "alert_above" && k.slice(0, 14) > pp) continue;
          if (path === "alert_below" && k.slice(0, 14) < pp) continue;
          await db().ref(`${path}/${k}`).remove();
          const al = (await db().ref(`users/${a.uid}/alerts/${a.id}`).get()).val();
          if (!al) continue;
          await db().ref(`users/${a.uid}/alerts/${a.id}`).remove();
          await notify(a.uid, `🔔 TFUEL price alert: $${price} (your target ${path === "alert_above" ? "≥" : "≤"} $${al.price})`);
          out.alerts++;
        }
      }
      // ---- limit orders ----
      if (s.orders_enabled && s.trade_enabled) {
        const sells = ((await db().ref("orderx_sell").orderByKey().endAt(pp + "~").limitToFirst(25).get()).val() || {}) as Record<string, any>;
        for (const k of Object.keys(sells).sort()) {
          if (k.slice(0, 14) > pp) continue;
          if (await fillOrder(sells[k].id, price, s)) out.orders++;
          else await db().ref(`orderx_sell/${k}`).remove();
        }
        const buys = ((await db().ref("orderx_buy").orderByKey().startAt(pp).limitToFirst(25).get()).val() || {}) as Record<string, any>;
        for (const k of Object.keys(buys).sort()) {
          if (k.slice(0, 14) < pp) continue;
          if (await fillOrder(buys[k].id, price, s)) out.orders++;
          else await db().ref(`orderx_buy/${k}`).remove();
        }
      }
    }
    // ---- energy ভরেছে ----
    if (s.notify_enabled) {
      for (const e of await drain("energy", now, 30)) {
        const u = (await db().ref(`users/${e.uid}/empty_at`).get()).val();
        if (u && u === e.ea) {
          await notify(e.uid, "⚡ Your energy is full again — come back and tap!");
          out.energy++;
        }
      }
      for (const e of await drain("stake", now, 30)) {
        await notify(e.uid, `🔓 Your stake is ready — claim ${(Number(e.total) / s.coins_per_tfuel).toLocaleString("en-US")} TFUEL in the app.`);
        out.stake++;
      }
    }
  } catch (e) {
    console.error("triggers failed", e);
  } finally {
    await db().ref("locks/triggers").remove().catch(() => {});
  }
  return out;
}
