import { authenticate } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { randomToken } from "@/lib/crypto";
import { RUN_TTL_MIN } from "@/lib/config";
import { ArticleSite, Run, urlWithRun } from "@/lib/chain";
import { ensureUser, MAX_AUTH_AGE_MONEY, UserRecord } from "@/lib/user";

/**
 * "Article Site" বাটন: নতুন run বানায় এবং cooldown-মুক্ত সাইটগুলোর মধ্য থেকে
 * random একটার ১ম আর্টিকেলের লিংক দেয়।
 */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "start-chain", 10);
  await ensureUser(user.id);

  const now = Date.now();
  const u = (await db().ref(`users/${user.id}`).get()).val() as UserRecord;

  // আগের চলমান run থাকলে সেটাই চালিয়ে যেতে দিই
  if (u.active_run) {
    const token = u.active_run;
    const run = (await db().ref(`runs/${token}`).get()).val() as Run | null;
    if (run && run.uid === user.id && (run.status === "running" || run.status === "code_issued") && run.expires_at > now) {
      const site = (await db().ref(`article_sites/${run.site_id}`).get()).val() as ArticleSite | null;
      if (site?.is_active && site.urls?.length) {
        const idx = Math.min(run.step_done, site.urls.length - 1);
        return void res.json({ success: true, url: urlWithRun(site.urls[idx], token), step: idx + 1, total: run.total, resumed: true });
      }
    }
  }

  // নতুন সাইট বাছাই
  const sites = ((await db().ref("article_sites").get()).val() || {}) as Record<string, ArticleSite>;
  const ok: string[] = [];
  let nextAt: number | null = null;
  for (const [id, s] of Object.entries(sites)) {
    if (!s.is_active || !s.urls?.length) continue;
    const readyAt = (u.completed_tasks?.[id]?.claimed_at || 0) + s.cooldown_minutes * 60000;
    if (readyAt <= now) ok.push(id);
    else if (nextAt === null || readyAt < nextAt) nextAt = readyAt;
  }
  if (!ok.length) {
    return void res.status(409).json({ success: false, error: "no_site_available", retry_at: nextAt });
  }

  const siteId = ok[Math.floor(Math.random() * ok.length)];
  const site = sites[siteId];
  const token = randomToken();

  const run: Run = {
    uid: user.id,
    site_id: siteId,
    total: site.urls.length,
    reward: Number(site.reward) || 0,
    step_arrived: 0,
    step_done: 0,
    arrived_at: 0,
    status: "running",
    failed: 0,
    created_at: now,
    expires_at: now + RUN_TTL_MIN * 60000,
  };
  await db().ref(`runs/${token}`).set(run);
  await db().ref(`users/${user.id}/active_run`).set(token);

  res.json({ success: true, url: urlWithRun(site.urls[0], token), step: 1, total: site.urls.length, resumed: false });
});
