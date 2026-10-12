import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/lib/firebase";
import { getSettings } from "@/lib/settings";
import { getPrice } from "@/lib/market";
import { processTriggers } from "@/lib/triggers";
import { payWeek } from "@/lib/leaderboard";
import { weekIndex } from "@/lib/wallet";

/**
 * পর্যায়ক্রমে চলে (Vercel Cron বা cron-job.org থেকে প্রতি মিনিটে/৫ মিনিটে GET)।
 * Authorization: Bearer <CRON_SECRET>  অথবা ?key=<CRON_SECRET>
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const secret = process.env.CRON_SECRET || "";
  const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || String(req.query.key || "");
  if (!secret || given !== secret) return res.status(401).json({ success: false, error: "Unauthorized" });
  try {
    const s = await getSettings(true);
    const p = await getPrice(s);
    const t = await processTriggers(p && !p.stale ? p.price : null);
    // গত সপ্তাহের leaderboard prize (একবারই)
    let paid: any = null;
    if (s.lb_enabled) paid = await payWeek(weekIndex() - 1, s);
    await db().ref("stats/cron_at").set(Date.now()).catch(() => {});
    res.json({ success: true, ...t, leaderboard: paid });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ success: false, error: "Server error" });
  }
}
