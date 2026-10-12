import { authenticate } from "@/lib/auth";
import { route } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ensureUser } from "@/lib/user";

/** বার্তা চালু/বন্ধ (Profile) */
export default route(async (req, res) => {
  const user = authenticate(req);
  await ensureUser(user, { soft: true });
  const on = !!req.body?.on;
  await db().ref(`users/${user.id}/notify_off`).set(on ? null : true);
  res.json({ success: true, on });
});
