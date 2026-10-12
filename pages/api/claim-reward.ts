import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ServerValue } from "firebase-admin/database";
import { chainCodeHash, safeEqualHex } from "@/lib/crypto";
import { Run, isToken } from "@/lib/chain";
import { bump, flag } from "@/lib/log";
import { activity, lbAdd } from "@/lib/wallet";
import { ensureUser, qualifyReferral, MAX_AUTH_AGE_MONEY, MAX_FAILED_ATTEMPTS } from "@/lib/user";

/** শেষ আর্টিকেলে পাওয়া ৬ ডিজিটের কোড দিয়ে reward নেওয়া */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "claim-reward", 20);

  const code = String(req.body?.inputCode ?? req.body?.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, "code_must_be_6_digits");
  await ensureUser(user);

  const token = (await db().ref(`users/${user.id}/active_run`).get()).val();
  if (!isToken(token)) throw new HttpError(404, "no_active_run");

  // run-এর একটাই node-এ atomic যাচাই: ভুল গণনা, মেয়াদ, একবারই ব্যবহার
  let out: { error?: string; left?: number; site_id?: string; reward?: number } = {};
  await db()
    .ref(`runs/${token}`)
    .transaction((r: Run | null) => {
      const now = Date.now();
      out = {};
      if (r === null) {
        out = { error: "no_active_run" };
        return r;
      }
      if (r.uid !== user.id) {
        out = { error: "no_active_run" };
        return;
      }
      if (r.status === "claimed") {
        out = { error: "already_claimed" };
        return;
      }
      if (r.status === "dead") {
        out = { error: "locked" };
        return;
      }
      if (r.status !== "code_issued") {
        out = { error: "finish_articles_first" };
        return;
      }
      if (r.expires_at <= now || (r.code_expires_at || 0) <= now) {
        out = { error: "code_expired" };
        return;
      }

      if (!r.code_hash || !safeEqualHex(r.code_hash, chainCodeHash(code, token))) {
        r.failed = (r.failed || 0) + 1; // ভুল গণনা সংরক্ষণ হয় (abort করলে হারাত)
        const left = MAX_FAILED_ATTEMPTS - r.failed;
        if (left <= 0) {
          r.status = "dead";
          delete r.code_hash;
        }
        out = { error: left <= 0 ? "locked" : "wrong_code", left: Math.max(0, left) };
        return r;
      }
      r.status = "claimed";
      r.claimed_at = now;
      delete r.code_hash;
      out = { site_id: r.site_id, reward: Number(r.reward) || 0 };
      return r;
    });

  if (out.error) {
    if (out.error === "wrong_code") await flag(user.id, "bad_codes");
    if (out.error === "locked") {
      await flag(user.id, "bad_codes");
      await flag(user.id, "locked");
      await db().ref(`users/${user.id}/active_run`).remove();
    }
    const status = out.error === "wrong_code" || out.error === "locked" ? 400 : 409;
    return void res.status(status).json({
      success: false,
      error: out.error,
      ...(out.left !== undefined ? { attempts_left: out.left } : {}),
    });
  }

  // run ইতিমধ্যে 'claimed' — এখন balance, cooldown ও active_run একসাথে atomic লিখি
  const { site_id, reward } = out as { site_id: string; reward: number };
  const update = {
    [`users/${user.id}/balance`]: ServerValue.increment(reward),
    [`users/${user.id}/earn/articles`]: ServerValue.increment(reward),
    [`users/${user.id}/completed_tasks/${site_id}`]: { claimed_at: Date.now() },
    [`users/${user.id}/active_run`]: null,
  };
  let lastErr: unknown = null;
  for (let i = 0; i < 3; i++) {
    try {
      await db().ref().update(update);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (lastErr) {
    console.error("claim credit failed", user.id, reward, lastErr);
    throw new HttpError(500, "credit_failed");
  }

  await bump(`stats/sites/${site_id}/claimed`);
  await lbAdd(user.id, reward);
  await activity(user.id, "article", { coins: reward, note: "Article site" });
  await qualifyReferral(user.id);
  const balance = (await db().ref(`users/${user.id}/balance`).get()).val();
  res.json({ success: true, reward, newBalance: balance });
});
