import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { sha256, sortableId } from "@/lib/crypto";
import { ensureUser, MAX_AUTH_AGE_MONEY } from "@/lib/user";

/** USDT deposit দাবি: user পাঠানোর পর txid দেয়; admin chain-এ মিলিয়ে ব্যালেন্সে যোগ করে */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "deposit", 6);
  const { settings: s } = await ensureUser(user);
  if (!s.deposit_enabled) throw new HttpError(403, "deposit_disabled");

  const net = s.deposit_networks.find((n) => n.id === String(req.body?.network || ""));
  if (!net) throw new HttpError(400, "bad_network");
  const txid = String(req.body?.txid || "").trim();
  if (!/^(0x)?[A-Za-z0-9]{16,100}$/.test(txid)) throw new HttpError(400, "bad_txid");
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount < net.min || amount > 1e6) throw new HttpError(400, "below_min_deposit");

  const mine = ((await db().ref(`users/${user.id}/deposits`).get()).val() || {}) as Record<string, any>;
  if (Object.values(mine).filter((d) => d.status === "pending").length >= 5) throw new HttpError(429, "too_many_pending");

  // একই txid দুইবার নয় (কেউ অন্যের/পুরনো txid ব্যবহার করলেও আটকায়)
  const key = sha256(txid.toLowerCase());
  const claim = await db()
    .ref(`deposit_txids/${key}`)
    .transaction((cur) => (cur === null ? user.id : undefined));
  if (!claim.committed) throw new HttpError(409, "txid_used");

  const id = sortableId();
  const now = Date.now();
  const rec = { network: net.id, network_name: net.name, txid, amount, status: "pending", created_at: now };
  await db()
    .ref()
    .update({
      [`deposits/${id}`]: { ...rec, uid: user.id, name: user.first_name || "User", txkey: key },
      [`users/${user.id}/deposits/${id}`]: rec,
    });
  res.json({ success: true, id });
});
