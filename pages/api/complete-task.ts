import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { earn, activity, lbAdd } from "@/lib/wallet";
import { ensureUser, qualifyReferral, newUser, UserRecord, MAX_AUTH_AGE_MONEY } from "@/lib/user";

/** timer_visit: server-এ মাপা সময় পার হলে পুরস্কার */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "complete-task", 30);

  const taskId = String(req.body?.taskId || "");
  if (!/^[\w-]{1,64}$/.test(taskId)) throw new HttpError(400, "Invalid taskId");

  const task = (await db().ref(`tasks/${taskId}`).get()).val();
  if (!task || task.type !== "timer_visit") throw new HttpError(404, "Task not found");

  await ensureUser(user);

  let failure: { status: number; msg: string } | null = null;
  const result = await db()
    .ref(`users/${user.id}`)
    .transaction((cur: UserRecord | null) => {
      if (cur === null) return newUser();
      failure = null;
      const now = Date.now();

      if (cur.completed_tasks?.[taskId]?.claimed) {
        failure = { status: 409, msg: "Already completed" };
        return;
      }
      const pending = cur.pending_tasks?.[taskId];
      if (!pending) {
        failure = { status: 400, msg: "Task not started" };
        return;
      }
      const waitMs = (task.min_wait_seconds || 10) * 1000;
      if (now - pending.started_at < waitMs) {
        failure = { status: 425, msg: "Too early" };
        return;
      }

      delete cur.pending_tasks![taskId];
      cur.completed_tasks = cur.completed_tasks || {};
      cur.completed_tasks[taskId] = { claimed: true, claimed_at: now };
      cur.balance += Number(task.reward) || 0;
      earn(cur, "tasks", Number(task.reward) || 0);
      return cur;
    });

  if (!result.committed) {
    const f = failure as { status: number; msg: string } | null;
    throw new HttpError(f?.status || 400, f?.msg || "Rejected");
  }
  await lbAdd(user.id, Number(task.reward) || 0);
  await activity(user.id, "task", { coins: Number(task.reward) || 0, note: String(task.title || "").slice(0, 60) });
  await qualifyReferral(user.id);
  const u = result.snapshot.val() as UserRecord;
  res.json({ success: true, reward: task.reward, newBalance: u.balance });
});
