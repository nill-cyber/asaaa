import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { sortableId } from "@/lib/crypto";
import { ensureUser, MAX_AUTH_AGE_MONEY } from "@/lib/user";
import { checkPin, pinHash } from "@/lib/prefs";

const clean = (v: any, n: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);

/** Settings: Withdraw PIN ও Saved addresses (user_prefs/{uid}) */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "account", 30);
  await ensureUser(user, { soft: true });
  const action = String(req.body?.action || "get");
  const base = `user_prefs/${user.id}`;

  if (action === "setPin") {
    const pin = String(req.body?.pin || "");
    if (!/^\d{4,6}$/.test(pin)) throw new HttpError(400, "bad_pin");
    await checkPin(user.id, req.body?.current); // আগে থেকে PIN থাকলে বর্তমানটা লাগবে
    await db().ref(`${base}/pin`).set({ h: pinHash(user.id, pin), fails: 0, set_at: Date.now() });
  } else if (action === "removePin") {
    await checkPin(user.id, req.body?.current);
    await db().ref(`${base}/pin`).remove();
  } else if (action === "addAddr") {
    const label = clean(req.body?.label, 20);
    const address = clean(req.body?.address, 100).replace(/\s/g, "");
    if (!label || address.length < 6) throw new HttpError(400, "bad_address");
    const cur = ((await db().ref(`${base}/addrs`).get()).val() || {}) as Record<string, any>;
    if (Object.keys(cur).length >= 10) throw new HttpError(400, "too_many_addrs");
    await db().ref(`${base}/addrs/${sortableId()}`).set({ label, address });
  } else if (action === "delAddr") {
    const id = String(req.body?.id || "");
    if (!/^[\w-]{1,40}$/.test(id)) throw new HttpError(400, "bad_request");
    await db().ref(`${base}/addrs/${id}`).remove();
  } else if (action !== "get") throw new HttpError(400, "bad_request");

  const p = ((await db().ref(base).get()).val() || {}) as any;
  res.json({
    success: true,
    pin: !!p.pin,
    pin_locked: (p.pin?.lock_until || 0) > Date.now(),
    addrs: Object.entries((p.addrs || {}) as Record<string, any>).map(([id, a]) => ({ id, label: a.label, address: a.address })),
  });
});
