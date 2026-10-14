import { ServerValue } from "firebase-admin/database";
import { db } from "./firebase";
import { HttpError } from "./auth";
import { sha256 } from "./crypto";
import { adminLog } from "./log";
import { notify } from "./notify";
import { activity } from "./wallet";
import { toU } from "./market";
import { getSettings } from "./settings";
import { getCreds, matchDeposit, recentDeposits, BinanceError } from "./binance";

export const INTENT_TTL_MS = 6 * 3600 * 1000;

/** approve / reject — admin বাটন ও Binance auto দুই জায়গা থেকেই ব্যবহার হয়। দুইবার credit হয় না (transaction) */
export async function settleDeposit(id: string, approve: boolean, credit: number, note: string, who: string) {
  let rec: any = null;
  let credKey = "";
  if (approve) {
    // একই txid কখনোই দুইবার credit হবে না (কে জমা দিয়েছে তা নির্বিশেষে)
    const cur = (await db().ref(`deposits/${id}`).get()).val();
    if (!cur || cur.status !== "pending") throw new HttpError(409, "not_pending");
    credKey = sha256(String(cur.txid).toLowerCase().replace(/^0x/, ""));
    const c = await db().ref(`deposit_credited/${credKey}`).transaction((x: any) => (x === null ? id : undefined));
    if (!c.committed) throw new HttpError(409, "txid_used");
  }
  await db().ref(`deposits/${id}`).transaction((d: any) => {
    rec = null;
    if (d === null) return d;
    if (d.status !== "pending") return;
    d.status = approve ? "approved" : "rejected";
    d.handled_at = Date.now();
    d.note = note;
    d.by = who;
    if (approve) d.credited = credit;
    rec = { ...d };
    return d;
  });
  if (!rec) {
    if (credKey) await db().ref(`deposit_credited/${credKey}`).remove();
    throw new HttpError(409, "not_pending");
  }
  const upd: Record<string, any> = {
    [`users/${rec.uid}/deposits/${id}/status`]: rec.status,
    [`users/${rec.uid}/deposits/${id}/note`]: note || null,
  };
  if (approve) {
    upd[`users/${rec.uid}/usdt_u`] = ServerValue.increment(toU(credit));
    upd[`users/${rec.uid}/deposits/${id}/credited`] = credit;
    upd[`users/${rec.uid}/usdt_tot/deposited`] = ServerValue.increment(toU(credit));
  } else {
    upd[`deposit_txids/${rec.txkey}`] = null; // বাতিল হলে txid আবার জমা দেওয়া যাবে
  }
  await db().ref().update(upd);
  await activity(rec.uid, approve ? "deposit" : "deposit_rejected", { usdt_u: approve ? toU(credit) : toU(Number(rec.amount) || 0), note });
  await notify(rec.uid, approve ? `✅ Deposit approved: +${credit} USDT added to your wallet.` : `❌ Deposit rejected.${note ? " Reason: " + note : ""}`);
  await adminLog(who, approve ? "deposit_approved" : "deposit_rejected", { id, uid: rec.uid, claimed: rec.amount, credited: approve ? credit : 0, note });
  return rec;
}

/** user-এর জন্য একটা অনন্য পরিমাণ (যেমন 50 → 50.37) — অন্য কেউ একই txid আগে জমা দিয়ে চুরি করতে পারবে না */
export async function allocateIntent(uid: string, netId: string, amount: number) {
  const now = Date.now();
  const old = (await db().ref(`deposit_intents/${uid}`).get()).val();
  if (old) await db().ref(`deposit_amounts/${old.net}/${old.amount_u}`).remove();
  const base = toU(amount);
  for (let i = 0; i < 40; i++) {
    const amt = base + (1 + Math.floor(Math.random() * 99)) * 10000; // +0.01 … +0.99
    const r = await db().ref(`deposit_amounts/${netId}/${amt}`).transaction((c: any) => (!c || c.exp < now ? { uid, exp: now + INTENT_TTL_MS } : undefined));
    if (r.committed) {
      const rec = { net: netId, amount_u: amt, exp: now + INTENT_TTL_MS };
      await db().ref(`deposit_intents/${uid}`).set(rec);
      return rec;
    }
  }
  throw new HttpError(503, "try_again");
}

export async function consumeIntent(uid: string, rec: { net: string; amount_u: number }) {
  await db().ref().update({ [`deposit_intents/${uid}`]: null, [`deposit_amounts/${rec.net}/${rec.amount_u}`]: null });
}

export type AutoResult = { status: "approved" | "waiting" | "none" | "mismatch" | "limit" | "unavailable"; note?: string };

/** একটা pending deposit Binance-এর সাথে মিলিয়ে দেখে; সব মিললে ও সীমার ভেতরে হলে নিজে approve */
export async function autoCheck(id: string): Promise<AutoResult> {
  const s = await getSettings(true);
  const d = (await db().ref(`deposits/${id}`).get()).val();
  if (!d || d.status !== "pending" || !d.auto) return { status: "none" };
  const net = s.deposit_networks.find((n) => n.id === d.network);
  const creds = await getCreds();
  if (!s.binance_auto || !net || !net.binance_network || !creds) return { status: "unavailable" };
  let list;
  try {
    list = await recentDeposits(creds, 3);
  } catch (e: any) {
    const note = e instanceof BinanceError ? e.message : "Binance check failed";
    await db().ref(`deposits/${id}/auto_note`).set(note);
    return { status: "unavailable", note };
  }
  const m = matchDeposit(list, { txid: d.txid, address: net.address, binanceNetwork: net.binance_network, expectU: Number(d.intent_u), toU });
  const set = (note: string, extra: Record<string, any> = {}) => db().ref(`deposits/${id}`).update({ auto_note: note, auto_checked_at: Date.now(), ...extra });
  if (m.kind === "none") { await set("Not on Binance yet — it may still be confirming"); return { status: "none" }; }
  if (m.kind === "waiting") { await set("Binance is still confirming this deposit"); return { status: "waiting" }; }
  if (m.kind === "mismatch") { await set(m.why + " — needs manual review"); return { status: "mismatch", note: m.why }; }
  if (m.amount > s.binance_auto_max) { await set(`Verified on Binance (${m.amount} USDT) — above the auto limit, approve manually`, { verified: m.amount }); return { status: "limit" }; }
  try {
    await settleDeposit(id, true, m.amount, "Auto-approved (Binance)", "binance-auto");
    return { status: "approved" };
  } catch (e: any) {
    if (e instanceof HttpError && e.status === 409) return { status: "none" };
    throw e;
  }
}

/** cron: Binance-এর জন্য অপেক্ষারত সব auto deposit আবার দেখে (৪৮ ঘণ্টার মধ্যের) */
export async function recheckAuto(): Promise<{ checked: number; approved: number }> {
  const s = await getSettings(true);
  if (!s.binance_auto) return { checked: 0, approved: 0 };
  const snap = (await db().ref("deposits").orderByKey().limitToLast(200).get()).val() || {};
  let checked = 0, approved = 0;
  const cutoff = Date.now() - 48 * 3600 * 1000;
  for (const [id, d] of Object.entries<any>(snap)) {
    if (d.status !== "pending" || !d.auto || d.created_at < cutoff) continue;
    checked++;
    try { if ((await autoCheck(id)).status === "approved") approved++; } catch (e) { console.error("autoCheck", e); }
  }
  return { checked, approved };
}
