import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ensureUser } from "@/lib/user";

/** timer_visit টাস্কের শুরুর সময় server-এ রেকর্ড করে */
export default route(async (req, res) => {
  const user = authenticate(req);
  await rateLimit(user.id, "start-task", 30);

  const taskId = String(req.body?.taskId || "");
  if (!/^[\w-]{1,64}$/.test(taskId)) throw new HttpError(400, "Invalid taskId");

  const task = (await db().ref(`tasks/${taskId}`).get()).val();
  if (!task || task.type !== "timer_visit") throw new HttpError(404, "Task not found");

  await ensureUser(user);

  const done = (await db().ref(`users/${user.id}/completed_tasks/${taskId}/claimed`).get()).val();
  if (done) throw new HttpError(409, "Already completed");

  // আগে শুরু করা থাকলে সময় রিসেট করা হয় না (বারবার start দিয়ে ফাঁকি আটকাতে)
  await db()
    .ref(`users/${user.id}/pending_tasks/${taskId}`)
    .transaction((cur) => cur ?? { started_at: Date.now() });

  res.json({ success: true });
});
