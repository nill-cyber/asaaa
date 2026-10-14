import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { sha256, sortableId } from "@/lib/crypto";
import { ensureUser, MAX_AUTH_AGE_MONEY } from "@/lib/user";
import { getCreds } from "@/lib/binance";
import { allocateIntent, autoCheck, consumeIntent } from "@/lib/deposits";
import { fromU } from "@/lib/market";

/**
 * USDT deposit।
 *  - Binance auto চালু থাকলে: action "intent" (অনন্য পরিমাণ) → user পাঠায় → txid জমা → সার্ভার Binance-এ মিলিয়ে নিজে credit করে।
 *  - না হলে (বা সেই network-এ binance_network না থাকলে): আগের মতো txid জমা → admin approve।
 *  - action "recheck": নিজের pending deposit আবার Binance-এ দেখা।
 */
export default route(async (req, res) => {
  const user = authenticate(req, MAX_AUTH_AGE_MONEY);
  await rateLimit(user.id, "deposit", 8);
  const { settings: s } = await ensureUser(user);
  if (!s.deposit_enabled) throw new HttpError(403, "deposit_disabled");
  const action = String(req.body?.action || "submit");

  if (action === "recheck") {
    const id = String(req.body?.id || "");
    if (!/^[\w-]{1,64}$/.test(id)) throw new HttpError(400, "bad_request");
    const d = (await db().ref(`deposits/${id}`).get()).val();
    if (!d || d.uid !== user.id) throw new HttpError(404, "not_found");
    const r = await autoCheck(id);
    return void res.json({ success: true, status: r.status });
  }

  const net = s.deposit_networks.find((n) => n.id === String(req.body?.network || ""));
  if (!net) throw new HttpError(400, "bad_network");
  const auto = s.binance_auto && !!net.binance_network && !!(await getCreds());

  if (action === "intent") {
    if (!auto) return void res.json({ success: true, auto: false });
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount < net.min || amount > 1e5) throw new HttpError(400, "below_min_deposit");
    const it = await allocateIntent(user.id, net.id, amount);
    return void res.json({ success: true, auto: true, exact: fromU(it.amount_u), expires_at: it.exp });
  }

  const txid = String(req.body?.txid || "").trim();
  if (!/^(0x)?[A-Za-z0-9]{16,100}$/.test(txid)) throw new HttpError(400, "bad_txid");
  let amount = Number(req.body?.amount);
  let intent: any = null;
  if (auto) {
    intent = (await db().ref(`deposit_intents/${user.id}`).get()).val();
    if (!intent || intent.net !== net.id || intent.exp < Date.now()) throw new HttpError(400, "need_intent");
    amount = fromU(intent.amount_u);
  } else if (!Number.isFinite(amount) || amount < net.min || amount > 1e6) {
    throw new HttpError(400, "below_min_deposit");
  }

  const mine = ((await db().ref(`users/${user.id}/deposits`).get()).val() || {}) as Record<string, any>;
  if (Object.values(mine).filter((d) => d.status === "pending").length >= 5) throw new HttpError(429, "too_many_pending");

  // একই txid দুইবার নয় (কেউ অন্যের/পুরনো txid ব্যবহার করলেও আটকায়)
  // auto-মোডে txid-র দাবি user-ভিত্তিক (অন্য কেউ আগে জমা দিয়ে আটকাতে পারে না); একবারের বেশি credit আটকায় settleDeposit
  const key = sha256(auto ? `${txid.toLowerCase()}:${user.id}` : txid.toLowerCase());
  const claim = await db()
    .ref(`deposit_txids/${key}`)
    .transaction((cur) => (cur === null ? user.id : undefined));
  if (!claim.committed) throw new HttpError(409, "txid_used");

  const id = sortableId();
  const now = Date.now();
  const rec: any = { network: net.id, network_name: net.name, txid, amount, status: "pending", created_at: now };
  if (auto) rec.auto = true;
  const full: any = { ...rec, uid: user.id, name: user.first_name || "User", txkey: key };
  if (auto) { full.intent_u = intent.amount_u; }
  await db().ref().update({ [`deposits/${id}`]: full, [`users/${user.id}/deposits/${id}`]: rec });
  if (!auto) return void res.json({ success: true, id, status: "pending" });

  await consumeIntent(user.id, intent);
  let status = "pending";
  try { status = (await autoCheck(id)).status; } catch (e) { console.error("autoCheck", e); }
  res.json({ success: true, id, status: status === "approved" ? "approved" : "pending", credited: status === "approved" ? amount : 0 });
});
