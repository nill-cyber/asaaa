import type { NextApiRequest, NextApiResponse } from "next";
import { HttpError } from "@/lib/auth";
import { rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { chainCodeHash, randomCode } from "@/lib/crypto";
import { CODE_TTL_MIN } from "@/lib/config";
import { bump, flag } from "@/lib/log";
import { ArticleSite, Run, hostOf, isToken, normHost, normUrl, urlWithRun } from "@/lib/chain";

/**
 * আর্টিকেল সাইটের chain.js এই endpoint ডাকে (Blogger/অন্য ডোমেইন থেকে, তাই CORS লাগে)।
 *  action=arrive   : এই আর্টিকেলে ঢুকেছি (ক্রম ঠিক কিনা দেখে, টাইমার শুরু করে)
 *  action=complete : পড়া শেষ (সময় পার হয়েছে কিনা দেখে, পরের লিংক বা ৬ ডিজিট কোড দেয়)
 * সব সিদ্ধান্ত server নেয়; কোড আগে থেকে কোথাও থাকে না।
 */

function cors(res: NextApiResponse, origin: string) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const origin = String(req.headers.origin || "");

  // preflight: কোন সাইট নিবন্ধিত তা না জেনে উত্তর দিতে হয়; আসল অনুরোধে নিচে কড়া যাচাই হয়
  if (req.method === "OPTIONS") {
    if (origin) cors(res, origin);
    return res.status(204).end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "post_only" });
  if (!origin) return res.status(403).json({ error: "no_origin" });

  try {
    let b: any = req.body;
    if (typeof b === "string") {
      try {
        b = JSON.parse(b);
      } catch {
        b = {};
      }
    }
    b = b || {};
    const token = String(b.r || "");
    const action = String(b.action || "");
    const pageUrl = String(b.url || "");
    if (!isToken(token) || (action !== "arrive" && action !== "complete")) {
      return res.status(400).json({ error: "bad_request" });
    }
    await rateLimit(token, "chain-step", 120);

    const run = (await db().ref(`runs/${token}`).get()).val() as Run | null;
    if (!run) return res.status(404).json({ error: "bad_run" });
    const site = (await db().ref(`article_sites/${run.site_id}`).get()).val() as ArticleSite | null;
    if (!site || !site.is_active || !site.urls?.length) return res.status(404).json({ error: "site_inactive" });

    // অনুরোধ আসা origin ঠিক এই run-এর সাইটের কিনা
    let originHost = "";
    try {
      originHost = normHost(new URL(origin).hostname);
    } catch {}
    if (originHost !== hostOf(site.urls[0])) return res.status(403).json({ error: "wrong_origin" });
    cors(res, origin);

    // এই পেজ কত নম্বর আর্টিকেল?
    const norm = site.urls.map((u) => normUrl(u));
    const me = normUrl(pageUrl);
    const idx = me ? norm.indexOf(me) : -1;
    if (idx < 0) return res.json({ error: "not_chain_page" });
    const step = idx + 1;
    const total = site.urls.length;
    const dwellMs = (Number(site.dwell_seconds) || 15) * 1000;
    const lockMs = Math.min(dwellMs - 1000, Math.max(0, (site.lock_seconds ?? 5) * 1000));
    const goUrl = (s: number) => urlWithRun(site.urls[Math.min(s, total) - 1], token);

    let out: Record<string, any> = {};
    await db()
      .ref(`runs/${token}`)
      .transaction((r: Run | null) => {
        const now = Date.now();
        if (!r) {
          out = { error: "bad_run" };
          return r; // null: server-এ ডেটা থাকলে আসল মান নিয়ে আবার চলবে
        }
        if (r.status !== "running" && r.status !== "code_issued") {
          out = { error: "run_closed" };
          return;
        }
        if (r.expires_at <= now) {
          out = { error: "run_expired" };
          return;
        }
        const doneStep = r.step_done;

        // ক্রম ভাঙা: সরাসরি পরের/শেষের আর্টিকেলে ঢুকলে কোড মিলবে না
        if (step > doneStep + 1) {
          out = { error: "out_of_order", need_step: doneStep + 1, go_url: goUrl(doneStep + 1), total };
          return;
        }

        // আগের (পড়া হয়ে যাওয়া) আর্টিকেলে ফিরলে শুধু পরের লিংক দিই
        if (step <= doneStep && step < total) {
          out = { ok: true, step, total, wait: 0, ready: true, next_url: goUrl(step + 1) };
          return;
        }

        const issue = (): Run => {
          const code = randomCode();
          r.code_hash = chainCodeHash(code, token);
          r.code_expires_at = now + CODE_TTL_MIN * 60000;
          r.status = "code_issued";
          out = { ok: true, step, total, code, code_ttl_min: CODE_TTL_MIN };
          return r;
        };

        // শেষ আর্টিকেল পড়া হয়ে গেছে: reload করলে নতুন কোড নিতে পারবে
        if (step === total && doneStep === total) {
          if (action === "arrive") {
            out = { ok: true, step, total, wait: 0, ready: true, last: true };
            return;
          }
          return issue();
        }

        // এখানে step == doneStep + 1
        if (r.step_arrived !== step) {
          r.step_arrived = step;
          r.arrived_at = now;
        }
        const remain = Math.max(0, dwellMs - (now - r.arrived_at));

        if (action === "arrive") {
          out = { ok: true, step, total, wait: Math.ceil(remain / 1000), ready: false, lock: Math.ceil(Math.max(0, lockMs - (now - r.arrived_at)) / 1000) };
          return r;
        }
        if (remain > 0) {
          out = { error: "too_early", wait: Math.ceil(remain / 1000) };
          return;
        }
        r.step_done = step;
        if (step < total) {
          out = { ok: true, step, total, next_url: goUrl(step + 1) };
          return r;
        }
        return issue();
      });

    if (out.error === "out_of_order") await flag(run.uid, "out_of_order");
    if (out.code) await bump(`stats/sites/${run.site_id}/finished`);

    // ত্রুটিও 200 দিয়ে ফেরত দিই, যাতে chain.js সহজে পড়তে পারে
    return res.json(out);
  } catch (e: any) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    console.error(e);
    return res.status(500).json({ error: "server_error" });
  }
}
