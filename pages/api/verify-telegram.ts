import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ensureUser, qualifyReferral, newUser, UserRecord, MAX_AUTH_AGE_MONEY } from "@/lib/user";
import { tgCall } from "@/lib/telegram";

const OK_STATUSES = new Set(["member", "administrator", "creator"]);

/** telegram_join: getChatMember দিয়ে যাচাই, তারপর transaction-এ এককালীন পুরস্কার */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "verify-telegram", 10);

  const taskId = String(req.body?.taskId || "");
  if (!/^[\w-]{1,64}$/.test(taskId)) throw new HttpError(400, "Invalid taskId");

  const task = (await db().ref(`tasks/${taskId}`).get()).val();
  if (!task || task.type !== "telegram_join") throw new HttpError(404, "Task not found");

  await ensureUser(user);

  const already = (await db().ref(`users/${user.id}/completed_tasks/${taskId}/claimed`).get()).val();
  if (already) throw new HttpError(409, "Already claimed");

  const tg = await tgCall("getChatMember", { chat_id: task.channel_id, user_id: user.id });

  if (!tg.ok) {
    // আসল কারণ শুধু admin-এর জন্য সংরক্ষিত (Admin → Channel check); user-কে সাধারণ বার্তা
    await db()
      .ref(`diagnostics/telegram/${taskId}`)
      .set({ at: Date.now(), channel: task.channel_id, title: task.title || "", reason: String(tg.description || "unknown") })
      .catch(() => {});
    throw new HttpError(502, "verify_unavailable");
  }
  if (!OK_STATUSES.has(tg.result?.status)) throw new HttpError(403, "not_joined");

  let failure = false;
  const result = await db()
    .ref(`users/${user.id}`)
    .transaction((cur: UserRecord | null) => {
      if (cur === null) return newUser();
      failure = false;
      if (cur.completed_tasks?.[taskId]?.claimed) {
        failure = true;
        return;
      }
      cur.completed_tasks = cur.completed_tasks || {};
      cur.completed_tasks[taskId] = { claimed: true, claimed_at: Date.now() };
      cur.balance += Number(task.reward) || 0;
      return cur;
    });

  if (!result.committed || failure) throw new HttpError(409, "Already claimed");
  await qualifyReferral(user.id);
  const u = result.snapshot.val() as UserRecord;
  res.json({ success: true, reward: task.reward, newBalance: u.balance });
});
