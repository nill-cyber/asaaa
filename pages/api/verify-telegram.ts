import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ensureUser, newUser, UserRecord, MAX_AUTH_AGE_MONEY } from "@/lib/user";

const OK_STATUSES = new Set(["member", "administrator", "creator"]);

/** telegram_join: getChatMember দিয়ে যাচাই, তারপর transaction-এ এককালীন পুরস্কার */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "verify-telegram", 10);

  const taskId = String(req.body?.taskId || "");
  if (!/^[\w-]{1,64}$/.test(taskId)) throw new HttpError(400, "Invalid taskId");

  const task = (await db().ref(`tasks/${taskId}`).get()).val();
  if (!task || task.type !== "telegram_join") throw new HttpError(404, "Task not found");

  await ensureUser(user.id);

  const already = (await db().ref(`users/${user.id}/completed_tasks/${taskId}/claimed`).get()).val();
  if (already) throw new HttpError(409, "Already claimed");

  const url =
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember` +
    `?chat_id=${encodeURIComponent(task.channel_id)}&user_id=${encodeURIComponent(user.id)}`;
  const tg = await fetch(url).then((r) => r.json()).catch(() => null);

  if (!tg?.ok) throw new HttpError(502, "Could not verify. Is the bot an admin of the channel?");
  if (!OK_STATUSES.has(tg.result?.status)) throw new HttpError(403, "You have not joined yet");

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
  const u = result.snapshot.val() as UserRecord;
  res.json({ success: true, reward: task.reward, newBalance: u.balance });
});
