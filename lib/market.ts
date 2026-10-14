import { db } from "./firebase";
import { Settings } from "./settings";

export const U = 1_000_000; // micro-USDT
export const toU = (usdt: number) => Math.round(usdt * U);
export const fromU = (u: number) => (Number(u) || 0) / U;

export interface PriceInfo {
  price: number;
  at: number;
  src: string;
  stale: boolean;
  override: boolean;
}
const STALE_MS = 10 * 60000;
let failAt = 0;
let mem: { p: number; at: number; src: string } | null = null;

async function getJson(url: string, ms = 4000): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** একাধিক উৎস পর পর: CoinGecko → Gate.io → Binance (Binance কিছু অঞ্চলে ব্লক, তাই শেষে) */
async function fetchLive(): Promise<{ p: number; src: string } | null> {
  const cg = await getJson("https://api.coingecko.com/api/v3/simple/price?ids=theta-fuel&vs_currencies=usd");
  const a = Number(cg?.["theta-fuel"]?.usd);
  if (a > 0) return { p: a, src: "coingecko" };
  const gate = await getJson("https://api.gateio.ws/api/v4/spot/tickers?currency_pair=TFUEL_USDT");
  const b = Number(gate?.[0]?.last);
  if (b > 0) return { p: b, src: "gate.io" };
  const bin = await getJson("https://api.binance.com/api/v3/ticker/price?symbol=TFUELUSDT");
  const c = Number(bin?.price);
  if (c > 0) return { p: c, src: "binance" };
  return null;
}

/** দাম: admin override → মেমরি cache (৩০সে) → DB cache → live। ১০ মিনিটের পুরনো হলে stale (trade বন্ধ) */
export async function getPrice(s: Settings, forceFresh = false): Promise<PriceInfo | null> {
  const now = Date.now();
  if (s.price_override > 0) return { price: s.price_override, at: now, src: "admin", stale: false, override: true };
  if (!forceFresh && mem && now - mem.at < 30000) return info(mem);

  const stored = ((await db().ref("market/price").get()).val() || null) as { p: number; at: number; src: string } | null;
  if (!forceFresh && stored && now - stored.at < 30000) {
    mem = stored;
    return info(stored);
  }
  const live = now - failAt < 30000 ? null : await fetchLive();
  if (!live) failAt = now;
  if (live) {
    mem = { p: live.p, at: now, src: live.src };
    const upd: Record<string, any> = { "market/price": mem };
    const bk = Math.floor(now / 300000);
    upd[`market/history/${bk}`] = live.p; // ৫ মিনিটে একটা বিন্দু
    upd[`market/history/${bk - 288 * 31}`] = null; // ৩১ দিনের পুরনো মুছে ফেলি
    await db().ref().update(upd).catch(() => {});
    return info(mem);
  }
  const last = stored || mem;
  return last ? info(last) : null;
}
const info = (x: { p: number; at: number; src: string }): PriceInfo => ({
  price: x.p,
  at: x.at,
  src: x.src,
  stale: Date.now() - x.at > STALE_MS,
  override: false,
});

/** শুধু DB থেকে দাম (নেটওয়ার্ক call ছাড়া) — me-র মতো দ্রুত endpoint-এর জন্য */
export async function peekPrice(s: Settings): Promise<number | null> {
  if (s.price_override > 0) return s.price_override;
  if (mem && Date.now() - mem.at < 30000) return mem.p;
  const st = ((await db().ref("market/price").get()).val() || null) as { p: number; at: number } | null;
  return st && st.p > 0 ? st.p : null;
}

export type Range = "1d" | "7d" | "30d" | "90d" | "1y";
const RANGES: Record<Range, { days: number; bucket: number; ttl: number }> = {
  "1d": { days: 1, bucket: 1800000, ttl: 600000 },
  "7d": { days: 7, bucket: 14400000, ttl: 1800000 },
  "30d": { days: 30, bucket: 14400000, ttl: 3600000 },
  "90d": { days: 90, bucket: 86400000, ttl: 6 * 3600000 },
  "1y": { days: 365, bucket: 4 * 86400000, ttl: 12 * 3600000 },
};
export type Candle = [number, number, number, number, number]; // t, o, h, l, c

/** নিজের জমানো ৫-মিনিটের বিন্দু থেকে candle বানায় (বাইরের উৎস না মিললে) */
export function toCandles(pts: [number, number][], bucket: number): Candle[] {
  const m = new Map<number, Candle>();
  for (const [t, p] of pts) {
    const k = Math.floor(t / bucket) * bucket;
    const c = m.get(k);
    if (!c) m.set(k, [k, p, p, p, p]);
    else {
      c[2] = Math.max(c[2], p);
      c[3] = Math.min(c[3], p);
      c[4] = p;
    }
  }
  return Array.from(m.values()).sort((a, b) => a[0] - b[0]);
}

/** চার্ট (line + candle), range অনুযায়ী cache। উৎস না মিললে নিজের জমানো বিন্দু */
export async function getChart(range: Range = "1d"): Promise<{ pts: [number, number][]; candles: Candle[]; change: number }> {
  const R = RANGES[range] || RANGES["1d"];
  const now = Date.now();
  const key = `market/chart_${range}`;
  const c = ((await db().ref(key).get()).val() || null) as { at: number; pts: [number, number][]; candles: Candle[] } | null;
  if (c && now - c.at < R.ttl && c.pts?.length > 5) return { pts: c.pts, candles: c.candles || [], change: change(c.pts) };

  const [j, o] = await Promise.all([
    getJson(`https://api.coingecko.com/api/v3/coins/theta-fuel/market_chart?vs_currency=usd&days=${R.days}`, 6000),
    getJson(`https://api.coingecko.com/api/v3/coins/theta-fuel/ohlc?vs_currency=usd&days=${R.days}`, 6000),
  ]);
  let pts: [number, number][] = [];
  let candles: Candle[] = [];
  if (Array.isArray(j?.prices) && j.prices.length > 5) {
    const step = Math.max(1, Math.floor(j.prices.length / 300));
    pts = j.prices.filter((_: any, i: number) => i % step === 0).map((x: number[]) => [x[0], x[1]]);
  }
  if (Array.isArray(o) && o.length > 3) candles = o.map((x: number[]) => [x[0], x[1], x[2], x[3], x[4]] as Candle);
  if (pts.length <= 5 || candles.length <= 3) {
    const h = ((await db().ref("market/history").get()).val() || {}) as Record<string, number>;
    const own = Object.entries(h)
      .map(([k, v]) => [Number(k) * 300000, Number(v)] as [number, number])
      .filter((x) => x[0] > now - R.days * 86400000)
      .sort((a, b) => a[0] - b[0]);
    if (pts.length <= 5) pts = own;
    if (candles.length <= 3) candles = toCandles(own, R.bucket);
  }
  if (pts.length > 5) await db().ref(key).set({ at: now, pts, candles }).catch(() => {});
  else if (c?.pts) return { pts: c.pts, candles: c.candles || [], change: change(c.pts) };
  return { pts, candles, change: change(pts) };
}
const change = (p: [number, number][]) => (p.length > 1 && p[0][1] ? (p[p.length - 1][1] / p[0][1] - 1) * 100 : 0);


export const INTERVALS = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000 } as const;
export type Interval = keyof typeof INTERVALS;
const kmem = new Map<string, { at: number; c: Candle[] }>();

/** সত্যিকারের candle (1m…1D): Gate.io → Binance → নিজের জমানো ৫-মিনিটের বিন্দু */
export async function getKlines(iv: Interval, limit = 200): Promise<{ pts: [number, number][]; candles: Candle[]; change: number }> {
  const hit = kmem.get(iv);
  let candles: Candle[] = hit && Date.now() - hit.at < 15000 ? hit.c : [];
  if (!candles.length) {
    const g = await getJson(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=TFUEL_USDT&interval=${iv}&limit=${limit}`, 5000);
    if (Array.isArray(g) && g.length > 3) {
      candles = g.map((r: any[]) => [Number(r[0]) * 1000, Number(r[5]), Number(r[3]), Number(r[4]), Number(r[2])] as Candle);
    } else {
      const b = await getJson(`https://api.binance.com/api/v3/klines?symbol=TFUELUSDT&interval=${iv}&limit=${limit}`, 5000);
      if (Array.isArray(b) && b.length > 3) candles = b.map((r: any[]) => [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4])] as Candle);
    }
    candles = candles.filter((c) => c.every((v) => Number.isFinite(v) && v > 0)).sort((a, b) => a[0] - b[0]);
    if (candles.length > 3) kmem.set(iv, { at: Date.now(), c: candles });
    else {
      const h = ((await db().ref("market/history").get()).val() || {}) as Record<string, number>;
      const own = Object.entries(h).map(([k, v]) => [Number(k) * 300000, Number(v)] as [number, number]).sort((a, b) => a[0] - b[0]);
      candles = toCandles(own, Math.max(300000, INTERVALS[iv])).slice(-limit);
    }
  }
  const pts = candles.map((c) => [c[0], c[4]] as [number, number]);
  return { pts, candles, change: change(pts) };
}
