import { authenticate } from "@/lib/auth";
import { route } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ensureUser, currentEnergy, UserRecord } from "@/lib/user";
import { ArticleSite, Run } from "@/lib/chain";
import { COINS_PER_UNIT, MIN_WITHDRAW, UNIT_LABEL, WITHDRAW_METHODS } from "@/lib/config";

/** Mini App খুললে প্রথম call: user state + task তালিকা + চলমান run + withdraw ইতিহাস (গোপন কিছু ছাড়া) */
export default route(async (req, res) => {
  const user = authenticate(req);
  await ensureUser(user.id);

  const [uSnap, tSnap, sSnap] = await Promise.all([
    db().ref(`users/${user.id}`).get(),
    db().ref("tasks").get(),
    db().ref("article_sites").get(),
  ]);
  const u = uSnap.val() as UserRecord;
  const now = Date.now();

  const tasks = Object.entries((tSnap.val() || {}) as Record<string, any>).map(([id, t]) => ({
    id,
    type: t.type,
    title: t.title,
    url:
      t.url ||
      (t.type === "telegram_join" && String(t.channel_id || "").startsWith("@")
        ? `https://t.me/${String(t.channel_id).slice(1)}`
        : undefined),
    reward: t.reward,
    min_wait_seconds: t.min_wait_seconds,
    channel_id: t.type === "telegram_join" ? t.channel_id : undefined,
    done: !!u.completed_tasks?.[id]?.claimed,
  }));

  // এখন কয়টা আর্টিকেল-সাইট খালি (cooldown শেষ)
  let sitesAvailable = 0;
  for (const [id, s] of Object.entries((sSnap.val() || {}) as Record<string, ArticleSite>)) {
    if (!s.is_active || !s.urls?.length) continue;
    const readyAt = (u.completed_tasks?.[id]?.claimed_at || 0) + s.cooldown_minutes * 60000;
    if (readyAt <= now) sitesAvailable++;
  }

  // চলমান run
  let run: { step_done: number; total: number; status: string } | null = null;
  if (u.active_run) {
    const r = (await db().ref(`runs/${u.active_run}`).get()).val() as Run | null;
    if (r && r.uid === user.id && (r.status === "running" || r.status === "code_issued") && r.expires_at > now) {
      run = { step_done: r.step_done, total: r.total, status: r.status };
    }
  }

  const withdrawals = Object.entries(u.withdrawals || {})
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 20)
    .map(([id, w]) => ({ id, amount: w.amount, method: w.method, status: w.status, created_at: w.created_at }));

  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.first_name,
      balance: u.balance,
      energy: Math.floor(currentEnergy(u)),
      maxEnergy: u.max_energy,
    },
    tasks,
    run,
    sitesAvailable,
    withdrawals,
    cfg: { minWithdraw: MIN_WITHDRAW, methods: WITHDRAW_METHODS, coinsPerUnit: COINS_PER_UNIT, unitLabel: UNIT_LABEL },
  });
});
