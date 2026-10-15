import { ServerValue } from "firebase-admin/database";
import { db } from "./firebase";
import type { Settings } from "./settings";
import { weekIndex, activity } from "./wallet";
import { notify } from "./notify";

export type Top = { id: string; v: number }[];

/** সর্বোচ্চ n জন (বড় থেকে ছোট) */
export async function top(board: string, n = 50): Promise<Top> {
  let v: Record<string, number>;
  try {
    v = ((await db().ref(`lb/${board}`).orderByValue().limitToLast(n).get()).val() || {}) as Record<string, number>;
  } catch (e) {
    console.error("leaderboard query failed, reading whole board", e);
    v = ((await db().ref(`lb/${board}`).get()).val() || {}) as Record<string, number>; // index/query সমস্যায় সরাসরি পড়ে JS-এ সাজাই
  }
  return Object.entries(v)
    .map(([id, x]) => ({ id, v: Number(x) || 0 }))
    .sort((a, b) => b.v - a.v);
}

export async function names(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    ids.map(async (id) => {
      out[id] = String((await db().ref(`users/${id}/name`).get()).val() || "Player").slice(0, 24);
    })
  );
  return out;
}

/** একটা সপ্তাহের শীর্ষ N জনকে prize (একবারই — lb_paid marker) */
export async function payWeek(idx: number, s: Settings) {
  if (idx < 0 || !s.lb_prizes.length) return { week: idx, paid: 0 };
  let first = false;
  await db()
    .ref(`lb_paid/w_${idx}`)
    .transaction((cur: number | null) => {
      first = cur === null;
      return cur === null ? Date.now() : undefined;
    });
  if (!first) return { week: idx, paid: 0, already: true };
  const t = (await top(`w_${idx}`, s.lb_prizes.length)).filter((x) => x.v > 0);
  let paid = 0;
  for (let i = 0; i < t.length && i < s.lb_prizes.length; i++) {
    const coins = Math.floor(s.lb_prizes[i]);
    if (coins < 1) continue;
    const uid = t[i].id;
    if ((await db().ref(`users/${uid}/balance`).get()).val() === null) continue;
    await db().ref().update({
      [`users/${uid}/balance`]: ServerValue.increment(coins),
      [`users/${uid}/earn/prize`]: ServerValue.increment(coins),
    });
    await activity(uid, "prize", { coins, note: `Weekly leaderboard #${i + 1}` });
    await notify(uid, `🏆 You finished #${i + 1} on last week's leaderboard! +${(coins / s.coins_per_tfuel).toLocaleString("en-US")} TFUEL was added to your balance.`);
    paid++;
  }
  return { week: idx, paid };
}

export const currentWeek = () => weekIndex();
