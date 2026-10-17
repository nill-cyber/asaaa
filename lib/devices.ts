import type { NextApiRequest } from "next";
import { db } from "./firebase";
import { sha256 } from "./crypto";
import { notify } from "./notify";

function label(ua: string) {
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iPhone / iPad" : /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Unknown device";
  const app = /Telegram/i.test(ua) ? "Telegram" : /Chrome/i.test(ua) ? "Chrome" : /Safari/i.test(ua) ? "Safari" : "Browser";
  return `${os} · ${app}`;
}

/** নতুন ডিভাইস থেকে লগইন হলে (আগে অন্তত একটা ডিভাইস থাকলে) Telegram-এ সতর্কবার্তা। best-effort, মূল কাজ আটকায় না */
export async function trackLogin(uid: string, req: NextApiRequest) {
  try {
    const ua = String(req.headers["user-agent"] || "").slice(0, 300);
    if (!ua) return;
    const h = sha256(ua.replace(/\d+(\.\d+)*/g, "")).slice(0, 16); // ভার্সন নম্বর বাদ, যাতে আপডেটে "নতুন ডিভাইস" না হয়
    const base = `user_prefs/${uid}`;
    const p = ((await db().ref(base).get()).val() || {}) as any;
    const devs = (p.devices || {}) as Record<string, any>;
    const now = Date.now();
    const cur = devs[h];
    if (cur) {
      if (now - cur.last > 3600000) await db().ref(`${base}/devices/${h}/last`).set(now);
      return;
    }
    const known = Object.keys(devs).length;
    const keys = Object.entries(devs).sort(([, a]: any, [, b]: any) => a.last - b.last);
    const upd: Record<string, any> = { [`${base}/devices/${h}`]: { label: label(ua), first: now, last: now } };
    while (keys.length >= 9) { const [k] = keys.shift()!; upd[`${base}/devices/${k}`] = null; }
    await db().ref().update(upd);
    if (known > 0 && p.login_alert !== false) {
      await notify(uid, `🔔 New login detected: ${label(ua)}. If this wasn't you, set a Withdraw PIN in Settings and contact support.`);
    }
  } catch (e) {
    console.error("trackLogin", e);
  }
}
