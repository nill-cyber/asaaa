import { ServerValue } from "firebase-admin/database";
import { db } from "./firebase";
import { U } from "./market";
import type { Settings } from "./settings";
import { activity } from "./wallet";
import { notify } from "./notify";

/** limit order / price alert-এর সূচক: দাম micro (১e-৮) করে ১৪ অঙ্কে সাজানো */
export const padPrice = (p: number) => String(Math.max(0, Math.round(p * 1e8))).padStart(14, "0");

export interface Order {
  uid: string;
  side: "buy" | "sell";
  coins: number; // sell: বেচার coin
  spend_u: number; // buy: খরচের micro-USDT (fee সহ)
  limit: number;
  status: "open" | "filled" | "cancelled";
  at: number;
}
export const idxPath = (side: "buy" | "sell") => (side === "sell" ? "orderx_sell" : "orderx_buy");

/** দাম limit ছুঁলে order পূরণ। এক order একবারই পূরণ হয় (status txn)। */
export async function fillOrder(id: string, price: number, s: Settings) {
  let o: Order | null = null;
  await db()
    .ref(`orders/${id}`)
    .transaction((cur: Order | null) => {
      o = null;
      if (cur === null) return cur;
      if (cur.status !== "open") return;
      cur.status = "filled";
      (cur as any).filled_at = Date.now();
      (cur as any).price = price;
      o = { ...cur };
      return cur;
    });
  if (!o) return false;
  const ord = o as Order;
  const fee = s.trade_fee_pct / 100;
  const cpt = s.coins_per_tfuel;
  const up: Record<string, any> = {
    [`${idxPath(ord.side)}/${padPrice(ord.limit)}_${id}`]: null,
    [`users/${ord.uid}/ord_open`]: ServerValue.increment(-1),
    [`users/${ord.uid}/orders/${id}/status`]: "filled",
    [`users/${ord.uid}/orders/${id}/price`]: price,
  };
  let coinsTotal = 0;
  let usdtDelta = 0;
  let gross = 0;
  let feeU = 0;
  if (ord.side === "sell") {
    gross = Math.round((ord.coins / cpt) * price * U);
    feeU = Math.floor(gross * fee);
    usdtDelta = gross - feeU;
    coinsTotal = -ord.coins;
    up[`users/${ord.uid}/usdt_u`] = ServerValue.increment(usdtDelta);
    up[`users/${ord.uid}/usdt_tot/sold`] = ServerValue.increment(usdtDelta);
    up[`users/${ord.uid}/spent/sold`] = ServerValue.increment(ord.coins);
  } else {
    gross = ord.spend_u;
    feeU = Math.floor(gross * fee);
    const coins = Math.floor(((gross - feeU) / U / price) * cpt);
    coinsTotal = coins;
    usdtDelta = -gross;
    up[`users/${ord.uid}/balance`] = ServerValue.increment(coins);
    up[`users/${ord.uid}/earn/bought`] = ServerValue.increment(coins);
    up[`users/${ord.uid}/usdt_tot/bought`] = ServerValue.increment(gross);
  }
  up[`trades/${id}`] = { uid: ord.uid, side: ord.side, coins: Math.abs(coinsTotal), usdt_u: Math.abs(usdtDelta), fee_u: feeU, price, at: Date.now(), limit: true };
  up["stats/trade_volume_u"] = ServerValue.increment(gross);
  up["stats/trade_fees_u"] = ServerValue.increment(feeU);
  await db().ref().update(up);
  const kind = ord.side === "sell" ? "limit_sell" : "limit_buy";
  // sell: coin আগেই কাটা, তাই activity-তে coin ঋণাত্মক দেখাই; buy: USDT আগেই কাটা
  await activity(ord.uid, kind, { coins: coinsTotal, usdt_u: usdtDelta, note: `@ $${price}` });
  await notify(
    ord.uid,
    ord.side === "sell"
      ? `✅ Limit sell filled: ${(ord.coins / cpt).toLocaleString("en-US")} TFUEL sold at $${price} → +${(usdtDelta / U).toFixed(2)} USDT`
      : `✅ Limit buy filled: bought ${(coinsTotal / cpt).toLocaleString("en-US")} TFUEL at $${price} (−${(gross / U).toFixed(2)} USDT)`
  );
  return true;
}
