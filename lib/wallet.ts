import { db } from "./firebase";
import { sortableId } from "./crypto";
import { dayKey } from "./log";
import { ServerValue } from "firebase-admin/database";
import type { UserRecord } from "./user";

/** "কীভাবে পেল / কীভাবে খরচ হলো" — user-এর TFUEL ও USDT-র উৎসের হিসাব */
export type EarnKey = "spin" | "promo" | "prize" | "ads" | "tap" | "articles" | "tasks" | "daily" | "referral" | "mining" | "staking" | "bought" | "adjust";
export type SpendKey = "boosts" | "sold" | "withdrawn";
export type UsdtKey = "deposited" | "sold" | "bought" | "withdrawn" | "adjusted";

/** transaction-এর ভেতরে cur-এর ওপর বসান */
export function earn(cur: UserRecord, key: EarnKey, coins: number) {
  if (!coins) return;
  cur.earn = cur.earn || {};
  cur.earn[key] = (cur.earn[key] || 0) + coins;
}
export function spend(cur: UserRecord, key: SpendKey, coins: number) {
  if (!coins) return;
  cur.spent = cur.spent || {};
  cur.spent[key] = (cur.spent[key] || 0) + coins;
}
export function usdtTot(cur: UserRecord, key: UsdtKey, micro: number) {
  if (!micro) return;
  cur.usdt_tot = cur.usdt_tot || {};
  cur.usdt_tot[key] = (cur.usdt_tot[key] || 0) + micro;
}

export type ActType =
  | "article" | "task" | "daily" | "referral" | "mining" | "stake_paid" | "boost"
  | "sell" | "buy" | "deposit" | "deposit_rejected" | "usdt_withdraw" | "usdt_paid" | "usdt_rejected" | "adjust" | "spin" | "promo" | "prize" | "ads" | "limit_buy" | "limit_sell";

/** সাম্প্রতিক কার্যকলাপ (best-effort; tap-এর মতো ঘন ঘন ঘটনা এখানে নয়) */
export async function activity(uid: string, type: ActType, o: { coins?: number; usdt_u?: number; note?: string } = {}) {
  try {
    await db()
      .ref(`activity/${uid}/${sortableId()}`)
      .set({ t: type, c: o.coins || 0, u: o.usdt_u || 0, n: (o.note || "").slice(0, 80), at: Date.now() });
  } catch {}
}

/** Leaderboard: দিন / সপ্তাহ (সোমবার থেকে) / সর্বকালের আয়। শুধু "আয়" (tap, task, mining…), কেনা বা admin credit নয় */
export const weekIndex = (t = Date.now()) => Math.floor((Math.floor(t / 86400000) - 4) / 7);
export const weekStart = (idx: number) => (idx * 7 + 4) * 86400000;
export async function lbAdd(uid: string, coins: number) {
  if (!(coins > 0)) return;
  try {
    const inc = ServerValue.increment(Math.floor(coins));
    await db().ref().update({ [`lb/d_${dayKey()}/${uid}`]: inc, [`lb/w_${weekIndex()}/${uid}`]: inc, [`lb/all/${uid}`]: inc });
  } catch {}
}
