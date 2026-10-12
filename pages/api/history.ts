import { authenticate } from "@/lib/auth";
import { route } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ensureUser } from "@/lib/user";
import { fromU } from "@/lib/market";

/** পূর্ণ লেনদেন ইতিহাস, নতুন থেকে পুরোনো; before = আগের পাতার শেষ id */
export default route(async (req, res) => {
  const user = authenticate(req);
  await ensureUser(user, { soft: true });
  const before = String(req.body?.before || "");
  const PAGE = 30;
  let q = db().ref(`activity/${user.id}`).orderByKey();
  if (/^[\w-]{1,64}$/.test(before)) q = q.endBefore(before);
  const v = ((await q.limitToLast(PAGE).get()).val() || {}) as Record<string, any>;
  const items = Object.entries(v)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([id, a]) => ({ id, t: a.t, c: a.c || 0, u: fromU(a.u || 0), n: a.n || "", at: a.at }));
  res.json({ success: true, items, more: items.length === PAGE, next: items.length ? items[items.length - 1].id : null });
});
