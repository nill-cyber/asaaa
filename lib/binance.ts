import crypto from "crypto";
import { db } from "./firebase";
import { open, seal } from "./secretbox";

const HOSTS = ["https://api.binance.com", "https://api1.binance.com", "https://api-gcp.binance.com"];

export interface Creds { key: string; secret: string; src: "env" | "db" }

/** key/secret: আগে Vercel env (BINANCE_API_KEY / BINANCE_API_SECRET), না থাকলে admin-এর সেভ করা (এনক্রিপ্টেড) */
export async function getCreds(): Promise<Creds | null> {
  const k = process.env.BINANCE_API_KEY, s = process.env.BINANCE_API_SECRET;
  if (k && s) return { key: k, secret: s, src: "env" };
  const v = (await db().ref("secrets/binance").get()).val();
  if (!v?.key || !v?.secret) return null;
  const key = open(v.key), secret = open(v.secret);
  return key && secret ? { key, secret, src: "db" } : null;
}

export async function saveCreds(key: string, secret: string) {
  await db().ref("secrets/binance").set({ key: seal(key), secret: seal(secret), hint: key.slice(0, 4) + "…" + key.slice(-4), saved_at: Date.now() });
}
export const clearCreds = () => db().ref("secrets/binance").remove();
export async function credHint(): Promise<{ src: string; hint: string } | null> {
  if (process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) {
    const k = process.env.BINANCE_API_KEY;
    return { src: "env", hint: k.slice(0, 4) + "…" + k.slice(-4) };
  }
  const v = (await db().ref("secrets/binance").get()).val();
  return v?.hint ? { src: "db", hint: v.hint } : null;
}

export class BinanceError extends Error {
  constructor(public code: string, msg: string) { super(msg); }
}

/** সই করা GET (read-only endpoint)। ৪৫১/৪০৩ হলে region blocked বলে জানায় */
export async function signedGet(c: Creds, path: string, params: Record<string, string | number> = {}): Promise<any> {
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), recvWindow: "10000", timestamp: String(Date.now()) });
  const sig = crypto.createHmac("sha256", c.secret).update(q.toString()).digest("hex");
  let last: any = null;
  for (const h of HOSTS) {
    try {
      const r = await fetch(`${h}${path}?${q.toString()}&signature=${sig}`, { headers: { "X-MBX-APIKEY": c.key }, signal: AbortSignal.timeout(8000) });
      if (r.status === 451 || r.status === 403) { last = new BinanceError("region", "Binance blocks requests from this server region (HTTP " + r.status + ")"); continue; }
      const j: any = await r.json().catch(() => null);
      if (!r.ok) throw new BinanceError("api", j?.msg ? `Binance: ${j.msg} (${j.code})` : `Binance HTTP ${r.status}`);
      return j;
    } catch (e: any) {
      if (e instanceof BinanceError && e.code === "api") throw e;
      last = e instanceof BinanceError ? e : new BinanceError("net", "Could not reach Binance");
    }
  }
  throw last || new BinanceError("net", "Could not reach Binance");
}

export interface KeyCheck { ok: boolean; problems: string[]; perms: Record<string, boolean> }

/** শুধু "Enable Reading" চালু থাকলেই OK; trading/withdraw/transfer/margin/futures কিছু চালু থাকলে প্রত্যাখ্যান */
export async function checkKey(c: Creds): Promise<KeyCheck> {
  const r = await signedGet(c, "/sapi/v1/account/apiRestrictions");
  const dangerous: [string, string][] = [
    ["enableWithdrawals", "Withdrawals"], ["enableSpotAndMarginTrading", "Spot & Margin trading"], ["enableMargin", "Margin"],
    ["enableFutures", "Futures"], ["enableInternalTransfer", "Internal transfer"], ["permitsUniversalTransfer", "Universal transfer"],
    ["enableVanillaOptions", "Options"], ["enablePortfolioMarginTrading", "Portfolio margin"],
  ];
  const problems: string[] = [];
  if (!r?.enableReading) problems.push("“Enable Reading” is off");
  for (const [k, label] of dangerous) if (r?.[k]) problems.push(`“${label}” is ON — turn it off`);
  return { ok: problems.length === 0, problems, perms: r || {} };
}

export interface BDeposit { amount: number; coin: string; network: string; status: number; address: string; txId: string; insertTime: number }

export async function recentDeposits(c: Creds, days = 3): Promise<BDeposit[]> {
  const j = await signedGet(c, "/sapi/v1/capital/deposit/hisrec", { coin: "USDT", limit: 1000, startTime: Date.now() - days * 86400000 });
  return (Array.isArray(j) ? j : []).map((d: any) => ({ amount: Number(d.amount), coin: String(d.coin), network: String(d.network || ""), status: Number(d.status), address: String(d.address || ""), txId: String(d.txId || ""), insertTime: Number(d.insertTime) || 0 }));
}

export type Match = { kind: "credited"; amount: number } | { kind: "waiting" } | { kind: "none" } | { kind: "mismatch"; why: string };

/** txid-কে Binance-এর ইতিহাসের সাথে মেলায়: সঠিক coin/network/address + final status + intent-এর সঠিক পরিমাণ */
export function matchDeposit(list: BDeposit[], o: { txid: string; address: string; binanceNetwork: string; expectU: number; toU: (n: number) => number }): Match {
  const norm = (s: string) => s.trim().toLowerCase().replace(/^0x/, "");
  const hit = list.find((d) => norm(d.txId) === norm(o.txid) || norm(d.txId).startsWith(norm(o.txid) + ":")); // কিছু network "txid:index" দেয়
  if (!hit) return { kind: "none" };
  if (hit.coin !== "USDT") return { kind: "mismatch", why: "Not a USDT deposit" };
  if (o.binanceNetwork && hit.network.toUpperCase() !== o.binanceNetwork.toUpperCase()) return { kind: "mismatch", why: `Network mismatch (${hit.network})` };
  if (hit.address.toLowerCase() !== o.address.toLowerCase()) return { kind: "mismatch", why: "Sent to a different address" };
  if (hit.status === 0 || hit.status === 6) return { kind: "waiting" }; // pending / credited-but-locked
  if (hit.status !== 1) return { kind: "mismatch", why: `Binance status ${hit.status}` };
  if (o.toU(hit.amount) !== o.expectU) return { kind: "mismatch", why: `Amount ${hit.amount} differs from the requested ${o.expectU / 1e6}` };
  return { kind: "credited", amount: hit.amount };
}

/** একটা txid সরাসরি Binance-এ খোঁজা (সময়-সীমা/limit-এর ঝামেলা নেই) */
export async function depositsByTxid(c: Creds, txid: string): Promise<BDeposit[]> {
  const out: BDeposit[] = [];
  for (const t of Array.from(new Set([txid, txid.replace(/^0x/i, ""), txid.startsWith("0x") ? txid : "0x" + txid]))) {
    try {
      const j = await signedGet(c, "/sapi/v1/capital/deposit/hisrec", { coin: "USDT", txId: t, limit: 50 });
      for (const d of Array.isArray(j) ? j : []) out.push(mapDep(d));
    } catch (e: any) {
      if (e instanceof BinanceError && e.code !== "api") throw e;
    }
    if (out.length) break;
  }
  return out;
}
const mapDep = (d: any): BDeposit => ({ amount: Number(d.amount), coin: String(d.coin), network: String(d.network || ""), status: Number(d.status), address: String(d.address || ""), txId: String(d.txId || ""), insertTime: Number(d.insertTime) || 0 });

/** txid না মিললে/না দিলে: সঠিক address+network+অনন্য পরিমাণ+intent-এর পরের সময় দিয়ে খোঁজা। পরিমাণ প্রতি user-এর জন্য অনন্য, তাই নিরাপদ */
export function matchByAmount(list: BDeposit[], o: { address: string; binanceNetwork: string; expectU: number; since: number; until?: number; toU: (n: number) => number }): Match & { txId?: string } {
  const hits = list.filter((d) => d.coin === "USDT" && d.address.toLowerCase() === o.address.toLowerCase() && d.network.toUpperCase() === o.binanceNetwork.toUpperCase() && o.toU(d.amount) === o.expectU && d.insertTime >= o.since - 5 * 60000 && (!o.until || d.insertTime <= o.until));
  if (!hits.length) return { kind: "none" };
  const ok = hits.find((d) => d.status === 1);
  if (ok) return { kind: "credited", amount: ok.amount, txId: ok.txId };
  return { kind: "waiting" };
}

export interface PayTx { id: string; amount: number; currency: string; time: number; from: string }

/** Binance Pay / internal transfer-এ পাওয়া USDT (read-only endpoint) */
export async function payReceived(c: Creds, since: number): Promise<PayTx[]> {
  const j = await signedGet(c, "/sapi/v1/pay/transactions", { startTime: Math.max(since - 600000, Date.now() - 30 * 86400000), endTime: Date.now() + 60000, limit: 100 });
  const rows: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
  return rows
    .map((r) => ({ id: String(r.transactionId || r.orderId || ""), amount: Number(r.amount), currency: String(r.currency || r.fundsDetail?.[0]?.currency || ""), time: Number(r.transactionTime) || 0, from: String(r.payerInfo?.binanceId || r.payerInfo?.accountId || "") }))
    .filter((r) => r.id && r.amount > 0 && r.currency === "USDT");
}

/** Binance ID দিয়ে পাঠানো: সঠিক অনন্য পরিমাণ + intent-এর পরের সময় */
export function matchPay(list: PayTx[], o: { expectU: number; since: number; until?: number; toU: (n: number) => number; orderId?: string }): { kind: "credited"; amount: number; id: string } | { kind: "none" } {
  const norm = (s: string) => s.trim().toLowerCase();
  const hit = list.find((p) => p.time >= o.since - 5 * 60000 && (!o.until || p.time <= o.until) && o.toU(p.amount) === o.expectU && (!o.orderId || norm(p.id) === norm(o.orderId)));
  return hit ? { kind: "credited", amount: hit.amount, id: hit.id } : { kind: "none" };
}

/** Internal transfer (transferType=1) deposit history-তেও আসে; Pay-তে না পেলে সেখানে দেখি */
export async function internalDeposits(c: Creds, since: number): Promise<{ id: string; amount: number; time: number }[]> {
  const j = await signedGet(c, "/sapi/v1/capital/deposit/hisrec", { coin: "USDT", limit: 1000, startTime: Math.max(since - 600000, Date.now() - 30 * 86400000) });
  return (Array.isArray(j) ? j : []).filter((d: any) => Number(d.transferType) === 1 && Number(d.status) === 1).map((d: any) => ({ id: String(d.txId || d.id || ""), amount: Number(d.amount), time: Number(d.insertTime) || 0 }));
}
