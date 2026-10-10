import type { NextApiRequest, NextApiResponse } from "next";
import { HttpError } from "./auth";
import { db } from "./firebase";

type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<void>;

/** POST-only wrapper + এক জায়গায় error handling + সহজ rate limit */
export function route(handler: Handler, opts: { limitPerMin?: number } = {}) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }
    try {
      await handler(req, res);
    } catch (e: any) {
      if (e instanceof HttpError) {
        return res.status(e.status).json({ success: false, error: e.message });
      }
      console.error(e);
      return res.status(500).json({ success: false, error: "Server error" });
    }
  };
}

/** প্রতি user + action-এ মিনিটে সীমা (RTDB transaction দিয়ে) */
export async function rateLimit(uid: string, action: string, max: number) {
  const minute = Math.floor(Date.now() / 60000);
  const ref = db().ref(`rate_limits/${uid}/${action}`);
  const result = await ref.transaction((cur) => {
    if (!cur || cur.minute !== minute) return { minute, count: 1 };
    if (cur.count >= max) return; // abort
    return { minute, count: cur.count + 1 };
  });
  if (!result.committed) throw new HttpError(429, "Too many requests");
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
