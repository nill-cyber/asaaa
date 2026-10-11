import { ServerValue } from "firebase-admin/database";
import { db } from "./firebase";
import { sortableId } from "./crypto";

/** admin-এর প্রতিটা পরিবর্তনের রেকর্ড (best-effort) */
export async function adminLog(by: string, action: string, detail: Record<string, any> = {}) {
  try {
    await db().ref(`admin_logs/${sortableId()}`).set({ at: Date.now(), by, action, detail });
  } catch (e) {
    console.error("adminLog failed", e);
  }
}

export type FlagKind = "too_fast" | "bad_codes" | "locked" | "out_of_order";

/** সন্দেহজনক আচরণের কাউন্টার (best-effort, কখনো মূল কাজ আটকায় না) */
export async function flag(uid: string, kind: FlagKind) {
  try {
    await db()
      .ref()
      .update({ [`flags/${uid}/${kind}`]: ServerValue.increment(1), [`flags/${uid}/last_at`]: Date.now() });
  } catch {}
}

export async function bump(path: string, n = 1) {
  try {
    await db().ref().update({ [path]: ServerValue.increment(n) });
  } catch {}
}

export const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
