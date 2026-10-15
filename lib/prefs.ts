import crypto from "crypto";
import { db } from "./firebase";
import { HttpError } from "./auth";

const secret = () => {
  const s = process.env.SERVER_SECRET;
  if (!s || s.length < 16) throw new Error("SERVER_SECRET missing or too short");
  return s;
};
export const pinHash = (uid: string, pin: string) => crypto.createHmac("sha256", secret()).update(`pin:${uid}:${pin}`).digest("hex");
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60000;

/**
 * Withdraw PIN: user চালু করলে প্রতিটা withdraw-এ লাগে। ৫ বার ভুলে ১৫ মিনিট লক।
 * PIN না থাকলে কিছুই হয় না।
 */
export async function checkPin(uid: string, pin: unknown) {
  const rec = (await db().ref(`user_prefs/${uid}/pin`).get()).val() as { h: string; fails?: number; lock_until?: number } | null;
  if (!rec) return;
  const now = Date.now();
  if ((rec.lock_until || 0) > now) throw new HttpError(429, "pin_locked");
  const p = String(pin ?? "");
  if (!/^\d{4,6}$/.test(p)) throw new HttpError(403, "pin_required");
  const ok = crypto.timingSafeEqual(Buffer.from(pinHash(uid, p), "hex"), Buffer.from(rec.h, "hex"));
  if (ok) {
    if (rec.fails) await db().ref(`user_prefs/${uid}/pin/fails`).set(0);
    return;
  }
  let locked = false;
  await db().ref(`user_prefs/${uid}/pin`).transaction((c: any) => {
    locked = false;
    if (!c) return c;
    c.fails = (c.fails || 0) + 1;
    if (c.fails >= MAX_FAILS) { c.fails = 0; c.lock_until = now + LOCK_MS; locked = true; }
    return c;
  });
  throw new HttpError(locked ? 429 : 403, locked ? "pin_locked" : "pin_wrong");
}
