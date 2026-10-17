import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { sortableId } from "@/lib/crypto";
import { ensureUser } from "@/lib/user";

const clean = (v: any, n: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, n);

/** Support: user টিকিট খোলে / উত্তর দেয় / নিজের টিকিট দেখে (admin উত্তর দেয় admin panel থেকে) */
export default route(async (req, res) => {
  const user = authenticate(req);
  await rateLimit(user.id, "support", 12);
  await ensureUser(user, { soft: true });
  const action = String(req.body?.action || "list");
  const idx = `user_tickets/${user.id}`;

  if (action === "create") {
    const subject = clean(req.body?.subject, 80);
    const message = clean(req.body?.message, 1000);
    if (subject.length < 3 || message.length < 5) throw new HttpError(400, "bad_request");
    const mine = Object.values(((await db().ref(idx).get()).val() || {}) as Record<string, any>);
    if (mine.filter((t) => t.status !== "closed").length >= 3) throw new HttpError(429, "ticket_limit");
    const id = sortableId();
    const now = Date.now();
    await db().ref().update({
      [`tickets/${id}`]: { uid: user.id, name: user.first_name || "User", subject, status: "open", created_at: now, updated_at: now, msgs: { [sortableId()]: { f: "user", t: message, at: now } } },
      [`${idx}/${id}`]: { subject, status: "open", updated_at: now },
    });
    return void res.json({ success: true, id });
  }

  if (action === "reply" || action === "get") {
    const id = String(req.body?.id || "");
    if (!/^[\w-]{1,64}$/.test(id)) throw new HttpError(400, "bad_request");
    const t = (await db().ref(`tickets/${id}`).get()).val();
    if (!t || t.uid !== user.id) throw new HttpError(404, "not_found");
    if (action === "reply") {
      const message = clean(req.body?.message, 1000);
      if (message.length < 2) throw new HttpError(400, "bad_request");
      if (t.status === "closed") throw new HttpError(409, "ticket_closed");
      const now = Date.now();
      await db().ref().update({ [`tickets/${id}/msgs/${sortableId()}`]: { f: "user", t: message, at: now }, [`tickets/${id}/status`]: "open", [`tickets/${id}/updated_at`]: now, [`${idx}/${id}/status`]: "open", [`${idx}/${id}/updated_at`]: now });
    }
    const f = (await db().ref(`tickets/${id}`).get()).val();
    return void res.json({ success: true, ticket: { id, subject: f.subject, status: f.status, msgs: Object.values(f.msgs || {}).sort((a: any, b: any) => a.at - b.at) } });
  }

  const list = Object.entries(((await db().ref(idx).get()).val() || {}) as Record<string, any>)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 30);
  res.json({ success: true, tickets: list });
});
