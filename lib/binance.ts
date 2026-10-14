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
