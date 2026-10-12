import type { NextApiRequest, NextApiResponse } from "next";
import { ServerValue } from "firebase-admin/database";
import { db } from "@/lib/firebase";

/**
 * Ad network-এর server-to-server callback (যেমন Adsgram "Reward URL"):
 *   https://<আপনার-site>/api/ad-callback?userid=[userId]&secret=<ADS_SECRET>
 * ADS_SECRET env সেট থাকলে ad-claim এই callback ছাড়া reward দেয় না।
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const secret = process.env.ADS_SECRET || "";
  const uid = String(req.query.userid || req.query.userId || "");
  if (!secret || String(req.query.secret || "") !== secret || !/^\d{1,20}$/.test(uid)) return res.status(403).json({ ok: false });
  try {
    if ((await db().ref(`users/${uid}/balance`).get()).val() === null) return res.status(404).json({ ok: false });
    await db().ref().update({ [`users/${uid}/ads/srv`]: ServerValue.increment(1) });
    res.status(200).json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
}
