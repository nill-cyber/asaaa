import { authenticate } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ensureUser } from "@/lib/user";

/** পরিচিতি (onboarding) দেখা শেষ */
export default route(async (req, res) => {
  const user = authenticate(req);
  await rateLimit(user.id, "onboard", 10);
  await ensureUser(user, { soft: true, touch: true });
  await db().ref(`users/${user.id}/onboarded`).set(true);
  res.json({ success: true });
});
