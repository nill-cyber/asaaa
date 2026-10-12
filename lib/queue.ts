import { db } from "./firebase";

/** সময়ভিত্তিক কাজের সারি: key = <সময়, ১৩ অঙ্ক>_<id> → বাকি অংশ payload */
export const pad13 = (t: number) => String(Math.max(0, Math.floor(t))).padStart(13, "0");
export const qKey = (at: number, id: string) => `${pad13(at)}_${id}`;

export async function enqueue(kind: string, at: number, id: string, payload: Record<string, any>) {
  try {
    await db().ref(`queue/${kind}/${qKey(at, id)}`).set(payload);
  } catch {}
}
export async function dequeue(kind: string, at: number, id: string) {
  try {
    await db().ref(`queue/${kind}/${qKey(at, id)}`).remove();
  } catch {}
}

/** now পর্যন্ত যত কাজ জমেছে (সবচেয়ে পুরোনো আগে); নিলে সারি থেকে সরে যায় */
export async function drain(kind: string, now: number, limit = 40): Promise<Record<string, any>[]> {
  const snap = await db().ref(`queue/${kind}`).orderByKey().endAt(pad13(now) + "~").limitToFirst(limit).get();
  const v = (snap.val() || {}) as Record<string, any>;
  const keys = Object.keys(v).sort();
  const out: Record<string, any>[] = [];
  for (const k of keys) {
    await db().ref(`queue/${kind}/${k}`).remove();
    out.push({ ...v[k], _key: k });
  }
  return out;
}
