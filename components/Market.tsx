import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { api, errText, fmtTf, fmtUsd } from "@/lib/client";
import Icon from "@/components/Icons";
import Logo from "@/components/Logo";
import { useAccount, PinField, AddrPicker } from "@/components/Settings";

type Say = (t: string, ok?: boolean) => void;
type Candle = [number, number, number, number, number];
interface M {
  price: { value: number; stale: boolean; at: number } | null;
  trade: { enabled: boolean; paused: string | null; buy: boolean; sell: boolean; feePct: number; min: number; max: number; dailyLimit: number; usedToday: number; coinsPerTfuel: number };
  orders?: { enabled: boolean; max: number; alertsMax: number };
  balances: { coins: number; usdt: number };
  deposit: { enabled: boolean; networks: { id: string; name: string; address: string; min: number; note: string; auto?: boolean }[] };
  payout: { enabled: boolean; networks: { id: string; name: string; min: number; fee: number }[] };
  trades: { id: string; side: string; coins: number; usdt_u: number; price: number; at: number }[];
  deposits: { id: string; network_name: string; amount: number; status: string; credited?: number; created_at: number; note?: string; auto?: boolean }[];
  payouts: { id: string; network_name: string; amount: number; receive: number; status: string; created_at: number; note?: string }[];
}

const usd = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const px = (n: number) => "$" + n.toFixed(n < 0.1 ? 5 : 3);
const day = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const stCls = (s: string) => (s === "paid" || s === "approved" ? "ok" : s === "rejected" ? "err" : "warn");
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const store = (k: string, v?: string) => {
  try {
    if (v !== undefined) localStorage.setItem(k, v);
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

/* ---------------- Live chart: line / candle, zoom + pan like trading sites ---------------- */
const RANGE_LABEL = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1D", "7d": "7D", "30d": "1M", "90d": "3M", "1y": "1Y" } as const;
const LONG = ["7d", "30d", "90d", "1y"];
type RangeKey = keyof typeof RANGE_LABEL;
const MIN_SPAN = 8;

function PriceChart({ live, onChange }: { live: number; onChange: (c: number) => void }) {
  const gid = "c" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [mode, setMode] = useState<"line" | "candle">(() => (store("chart_mode") === "line" ? "line" : "candle"));
  const [range, setRange] = useState<RangeKey>(() => ((store("chart_iv") || "") in RANGE_LABEL ? (store("chart_iv") as RangeKey) : "1m"));
  const [data, setData] = useState<{ pts: [number, number][]; candles: Candle[] } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [win, setWin] = useState<[number, number] | null>(null); // null = show everything
  const ref = useRef<SVGSVGElement>(null);
  const ptrs = useRef(new Map<number, number>());
  const drag = useRef<{ x0: number; w0: [number, number]; moved: boolean } | null>(null);
  const pinch = useRef<{ d0: number; w0: [number, number]; c0: number } | null>(null);

  useEffect(() => {
    setData(null);
    setWin(null);
    let dead = false;
    const go = () =>
      api<any>("market-chart", LONG.includes(range) ? { range } : { interval: range })
        .then((d) => !dead && setData({ pts: d.pts || [], candles: d.candles || [] }))
        .catch(() => {});
    go();
    const iv = setInterval(go, range === "1m" ? 20000 : LONG.includes(range) ? 300000 : 60000);
    return () => {
      dead = true;
      clearInterval(iv);
    };
  }, [range]);

  // live price → last point / last candle
  const view = useMemo(() => {
    if (!data) return null;
    const pts = data.pts.map((p) => [...p] as [number, number]);
    if (live > 0 && pts.length) pts[pts.length - 1] = [Date.now(), live];
    const candles = data.candles.map((c) => [...c] as Candle);
    if (live > 0 && candles.length) {
      const l = candles[candles.length - 1];
      l[4] = live;
      l[2] = Math.max(l[2], live);
      l[3] = Math.min(l[3], live);
    }
    return { pts, candles };
  }, [data, live]);

  const change = view && view.pts.length > 1 && view.pts[0][1] ? (view.pts[view.pts.length - 1][1] / view.pts[0][1] - 1) * 100 : 0;
  useEffect(() => onChange(change), [change, onChange]);
  const up = change >= 0;
  const col = up ? "#16a34a" : "#e5484d";

  const W = 340, H = 190, PR = 46, PT = 8, PB = 8;
  const cw = W - PR;
  const n = view ? (mode === "candle" ? view.candles.length : view.pts.length) : 0;

  // ---- window (zoom / pan) ----
  const fit = (s0: number, e0: number): [number, number] => {
    const min = Math.min(MIN_SPAN, n);
    const span = Math.min(n, Math.max(min, e0 - s0));
    let a = s0;
    if (a < 0) a = 0;
    if (a + span > n) a = n - span;
    return [a, a + span];
  };
  const [ws, we] = win ? fit(win[0], win[1]) : [0, n];
  const span = Math.max(1, we - ws);
  const zoomed = n > 0 && span < n - 0.5;
  const zoomAt = (factor: number, frac: number, base?: [number, number]) => {
    const [s0, e0] = base || [ws, we];
    const sp = e0 - s0;
    const idx = s0 + frac * sp;
    const nsp = sp / factor;
    setWin(fit(idx - frac * nsp, idx - frac * nsp + nsp));
  };
  const fracOf = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return 0.5;
    return Math.max(0, Math.min(1, ((clientX - r.left) / r.width) * (W / cw)));
  };

  // wheel zoom (desktop) — needs a non-passive listener to stop page scroll
  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;
  const fracRef = useRef(fracOf);
  fracRef.current = fracOf;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      zoomRef.current(e.deltaY < 0 ? 1.25 : 0.8, fracRef.current(e.clientX));
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [n > 2]);

  const hoverAt = (clientX: number) => setHover(Math.max(0, Math.min(n - 1, Math.floor(ws + fracOf(clientX) * span))));
  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, e.clientX);
    if (ptrs.current.size === 2) {
      const [a, b] = Array.from(ptrs.current.values());
      pinch.current = { d0: Math.max(10, Math.abs(a - b)), w0: [ws, we], c0: fracOf((a + b) / 2) };
      drag.current = null;
      setHover(null);
    } else if (ptrs.current.size === 1) {
      drag.current = { x0: e.clientX, w0: [ws, we], moved: false };
      hoverAt(e.clientX);
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (n < 3) return;
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, e.clientX);
    if (pinch.current && ptrs.current.size >= 2) {
      const [a, b] = Array.from(ptrs.current.values());
      zoomAt(Math.abs(a - b) / pinch.current.d0, pinch.current.c0, pinch.current.w0);
      return;
    }
    const d = drag.current;
    if (d) {
      const r = ref.current?.getBoundingClientRect();
      const dx = e.clientX - d.x0;
      if (Math.abs(dx) > 6) d.moved = true;
      if (d.moved && r && zoomed) {
        const per = (d.w0[1] - d.w0[0]) / ((r.width * cw) / W); // data units per px
        setWin(fit(d.w0[0] - dx * per, d.w0[1] - dx * per));
        setHover(null);
        return;
      }
      if (!d.moved) return hoverAt(e.clientX);
      return;
    }
    if (e.pointerType === "mouse") hoverAt(e.clientX);
  };
  const onUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
    if (ptrs.current.size === 0) drag.current = null;
    if (e.pointerType !== "mouse") setHover(null);
  };

  // ---- drawing (only the visible slice; y-axis rescales like trading apps) ----
  let body: React.ReactNode = null;
  let lo = 0, hi = 1;
  let yLive: number | null = null;
  const ok = !!view && n > 2;
  const i0 = Math.max(0, Math.floor(ws) - 1), i1 = Math.min(n - 1, Math.ceil(we));
  const slot = cw / span;
  const x = (i: number) => (i - ws + 0.5) * slot;
  if (ok && view) {
    if (mode === "candle") {
      let l = Infinity, h = -Infinity;
      for (let i = i0; i <= i1; i++) {
        l = Math.min(l, view.candles[i][3]);
        h = Math.max(h, view.candles[i][2]);
      }
      lo = l; hi = h;
    } else {
      let l = Infinity, h = -Infinity;
      for (let i = i0; i <= i1; i++) {
        l = Math.min(l, view.pts[i][1]);
        h = Math.max(h, view.pts[i][1]);
      }
      lo = l; hi = h;
    }
    const pad = (hi - lo) * 0.08 || hi * 0.01;
    lo -= pad;
    hi += pad;
    const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
    if (live > 0 && live >= lo && live <= hi) yLive = y(live);
    if (mode === "line") {
      const line = view.pts.slice(i0, i1 + 1).map((p, k) => `${k ? "L" : "M"}${x(i0 + k).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
      body = (
        <>
          <path d={`${line} L${x(i1)},${H} L${x(i0)},${H} Z`} fill={`url(#${gid})`} />
          <path d={line} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </>
      );
    } else {
      const bw = Math.max(1.5, Math.min(16, slot * 0.7));
      body = view.candles.slice(i0, i1 + 1).map((c, k) => {
        const g = c[4] >= c[1];
        const kc = g ? "#16a34a" : "#e5484d";
        const top = y(Math.max(c[1], c[4])), bot = y(Math.min(c[1], c[4]));
        const cx = x(i0 + k);
        return (
          <g key={i0 + k}>
            <line x1={cx} x2={cx} y1={y(c[2])} y2={y(c[3])} stroke={kc} strokeWidth="1.2" />
            <rect x={cx - bw / 2} y={top} width={bw} height={Math.max(1.5, bot - top)} fill={kc} rx="1" />
          </g>
        );
      });
    }
  }
  const h = hover !== null && view && mode === "candle" ? view.candles[hover] : null;
  const hp = hover !== null && view && mode === "line" ? view.pts[hover] : null;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, v: hi - (hi - lo) * f }));
  const when = (t: number) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const t0 = ok && view ? (mode === "candle" ? view.candles[Math.max(0, Math.round(ws))][0] : view.pts[Math.max(0, Math.round(ws))][0]) : 0;
  const t1 = ok && view ? (mode === "candle" ? view.candles[Math.min(n - 1, Math.round(we) - 1)][0] : view.pts[Math.min(n - 1, Math.round(we) - 1)][0]) : 0;
  const sel: React.CSSProperties = { width: "auto", padding: "6px 28px 6px 12px", borderRadius: 12, fontWeight: 700, fontSize: 14, minHeight: 0 };
  const zbtn: React.CSSProperties = { padding: "2px 9px", border: "1px solid var(--line)", borderRadius: 8, background: "var(--card)", fontWeight: 700, fontSize: 13, lineHeight: "18px", color: "var(--text)" };

  return (
    <div>
      <div className="row" style={{ margin: "8px 0 4px" }}>
        <div className="gap">
          <select aria-label="Interval" value={range} style={sel} onChange={(e) => { const v = e.target.value as RangeKey; setRange(v); store("chart_iv", v); }}>
            {(Object.keys(RANGE_LABEL) as RangeKey[]).map((r) => <option key={r} value={r}>{RANGE_LABEL[r]}</option>)}
          </select>
          <select aria-label="Chart type" value={mode} style={sel} onChange={(e) => { const v = e.target.value as "line" | "candle"; setMode(v); setWin(null); store("chart_mode", v); }}>
            <option value="candle">Candles</option>
            <option value="line">Line</option>
          </select>
        </div>
      </div>
      <div className="xs num" style={{ minHeight: 24, color: "var(--muted)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <span>
          {h ? `${when(h[0])} · O ${px(h[1])} H ${px(h[2])} L ${px(h[3])} C ${px(h[4])}` : hp ? `${when(hp[0])} · ${px(hp[1])}` : ok ? `${when(t0)} → ${when(t1)}` : ""}
        </span>
        {ok && (
          <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button aria-label="Zoom out" style={zbtn} onClick={() => zoomAt(0.6, 1)}>−</button>
            <button aria-label="Zoom in" style={zbtn} onClick={() => zoomAt(1.6, 1)}>+</button>
            {zoomed && <button aria-label="Reset zoom" style={{ ...zbtn, fontSize: 11 }} onClick={() => setWin(null)}>Reset</button>}
          </span>
        )}
      </div>
      {!ok ? (
        <div className="empty" style={{ padding: 40 }}>{view ? "Chart will appear shortly" : "Loading chart…"}</div>
      ) : (
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", touchAction: "pan-y", cursor: zoomed ? "grab" : "crosshair", userSelect: "none" }} onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={col} stopOpacity=".22" />
              <stop offset="1" stopColor={col} stopOpacity="0" />
            </linearGradient>
            <clipPath id={gid + "k"}><rect x="0" y="0" width={cw} height={H} /></clipPath>
          </defs>
          {grid.map((g) => (
            <g key={g.f}>
              <line x1="0" x2={cw} y1={PT + g.f * (H - PT - PB)} y2={PT + g.f * (H - PT - PB)} stroke="#e7ebf3" strokeDasharray="3 4" />
              <text x={W - 2} y={PT + g.f * (H - PT - PB) + (g.f === 0 ? 10 : g.f === 1 ? -3 : 3)} textAnchor="end" fontSize="9" fill="#6b7690">{g.v.toFixed(g.v < 0.1 ? 5 : 3)}</text>
            </g>
          ))}
          <g clipPath={`url(#${gid}k)`}>{body}</g>
          {yLive !== null && (
            <g>
              <line x1="0" x2={cw} y1={yLive} y2={yLive} stroke={col} strokeDasharray="2 3" strokeOpacity=".7" />
              <rect x={cw + 1} y={yLive - 7} width={PR - 2} height="14" rx="3" fill={col} />
              <text x={W - 3} y={yLive + 3.5} textAnchor="end" fontSize="9" fontWeight="700" fill="#fff">{live.toFixed(live < 0.1 ? 5 : 3)}</text>
            </g>
          )}
          {hover !== null && x(hover) >= 0 && x(hover) <= cw && <line x1={x(hover)} x2={x(hover)} y1={PT} y2={H - PB} stroke="#6b7690" strokeOpacity=".5" />}
        </svg>
      )}
      {ok && <div className="xs muted" style={{ textAlign: "center", marginTop: 2 }}>Pinch or scroll to zoom · drag to move</div>}
    </div>
  );
}

type Sub = "trade" | "orders" | "history";
export default function Market({ say, reload, cpt, startSub }: { say: Say; reload: () => void; cpt: number; startSub?: string }) {
  const [m, setM] = useState<M | null>(null);
  const [change, setChange] = useState(0);
  const [sub, setSub] = useState<Sub>((["trade", "orders", "history"].includes(startSub || "") ? startSub : "trade") as Sub);

  const load = useCallback(async () => {
    try {
      setM(await api<M>("market"));
    } catch (e: any) {
      say(errText(e));
    }
  }, [say]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000); // live price
    return () => clearInterval(iv);
  }, [load]);

  if (!m) return <div className="empty">Loading market…</div>;
  const up = change >= 0;
  const price = m.price?.value || 0;
  const done = () => {
    load();
    reload();
  };

  return (
    <>
      <div className="balance-card" style={{ marginTop: 0, marginBottom: 12 }}>
        <div className="lbl">Total balance</div>
        <div className="amt num"><Logo size={32} />{fmtTf(m.balances.coins, cpt)}<span className="unit">TFUEL</span></div>
        <div className="eq num">≈ {fmtUsd((m.balances.coins / cpt) * price + m.balances.usdt)} USDT</div>
      </div>
      <div className="card" style={{ paddingBottom: 8 }}>
        <div className="row">
          <div className="left">
            <Logo size={36} />
            <div>
              <div className="title" style={{ fontSize: 18 }}>TFUEL <span className="muted" style={{ fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}>/ <Logo kind="usdt" size={16} /> USDT</span></div>
              <div className="sub" style={{ display: "flex", alignItems: "center", gap: 6 }}><span className="livedot" /> Live · USDT</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="big num" style={{ fontSize: 24 }}>{price ? px(price) : "—"}</div>
            <span className={`pill ${up ? "ok" : "err"}`}>{up ? "+" : ""}{change.toFixed(2)}%</span>
          </div>
        </div>
        <PriceChart live={price} onChange={setChange} />
      </div>

      <div className="grid2" style={{ marginBottom: 12 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="sub" style={{ display: "flex", alignItems: "center", gap: 6 }}><Logo size={16} /> TFUEL</div>
          <div className="title num" style={{ fontSize: 18 }}>{fmtTf(m.balances.coins, cpt)}</div>
          <div className="xs muted">≈ {fmtUsd((m.balances.coins / cpt) * price)}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="sub" style={{ display: "flex", alignItems: "center", gap: 6 }}><Logo kind="usdt" size={16} /> USDT</div>
          <div className="title num" style={{ fontSize: 18 }}>{usd(m.balances.usdt, 2)}</div>
          <div className="xs muted">Available</div>
        </div>
      </div>

      <div className="seg">
        {(["trade", "orders", "history"] as const).map((k) => (
          <button key={k} className={sub === k ? "on" : ""} style={{ padding: "8px 4px" }} onClick={() => setSub(k)}>{k === "history" ? "Trade history" : cap(k)}</button>
        ))}
      </div>

      {sub === "trade" && <Trade m={m} cpt={cpt} say={say} done={done} />}
      {sub === "orders" && <Orders m={m} cpt={cpt} say={say} done={done} />}
      {sub === "history" && <History m={m} cpt={cpt} say={say} done={done} />}
    </>
  );
}

function Trade({ m, cpt, say, done }: { m: M; cpt: number; say: Say; done: () => void }) {
  const [side, setSide] = useState<"buy" | "sell">("sell");
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const t = m.trade;
  const price = m.price?.value || 0;
  const n = Number(amt) || 0;
  const fee = t.feePct / 100;
  // sell: amount is TFUEL; buy: amount is USDT
  const coins = side === "sell" ? Math.floor(n * cpt) : 0;
  const gross = side === "sell" ? (coins / cpt) * price : n;
  const out = side === "sell" ? gross * (1 - fee) : Math.floor(((n * (1 - fee)) / (price || 1)) * cpt);
  const sideOff = side === "buy" ? !t.buy : !t.sell;

  const go = async () => {
    setBusy(true);
    try {
      const r = await api<any>("trade", { side, amount: side === "sell" ? coins : n, price_seen: price });
      say(side === "sell" ? `Sold for ${usd(r.usdt, 2)} USDT` : `Bought ${fmtTf(r.coins, cpt)} TFUEL`, true);
      setAmt("");
      done();
    } catch (e: any) {
      if (e.message === "price_changed") {
        say("Price just moved. Please review and try again.");
        done();
      } else say(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      {t.paused && (
        <div className="banner warn" style={{ marginTop: 0 }}>
          <Icon name="alert" size={18} />
          <span>{t.paused === "off" ? "Trading is currently paused." : "Live price is temporarily unavailable. Trading will resume shortly."}</span>
        </div>
      )}
      <div className="seg">
        <button className={side === "sell" ? "on" : ""} onClick={() => { setSide("sell"); setAmt(""); }}>Sell TFUEL</button>
        <button className={side === "buy" ? "on" : ""} onClick={() => { setSide("buy"); setAmt(""); }}>Buy TFUEL</button>
      </div>
      <label style={{ marginTop: 0 }}>{side === "sell" ? "TFUEL to sell" : "USDT to spend"}</label>
      <div style={{ position: "relative" }}>
        <input inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} />
        <button className="btn sec sm" style={{ position: "absolute", right: 6, top: 6 }} onClick={() => setAmt(side === "sell" ? String(Math.floor(m.balances.coins) / cpt) : String(Math.floor(m.balances.usdt * 100) / 100))}>Max</button>
      </div>
      <div className="card" style={{ background: "var(--soft)", boxShadow: "none", border: 0, margin: "12px 0" }}>
        <div className="row sm"><span className="muted">You receive ≈</span><b className="num">{n > 0 && price ? (side === "sell" ? `${usd(out, 4)} USDT` : `${fmtTf(out, cpt)} TFUEL`) : "—"}</b></div>
        <div className="row sm" style={{ marginTop: 6 }}><span className="muted">Fee ({t.feePct}%)</span><span className="num">{n > 0 && price ? `${usd(gross * fee, 4)} USDT` : "—"}</span></div>
        <div className="row sm" style={{ marginTop: 6 }}><span className="muted">Price</span><span className="num">1 TFUEL = {price ? px(price) : "—"} USDT</span></div>
      </div>
      <div className="xs muted" style={{ marginBottom: 10 }}>
        Per trade: {usd(t.min, 2)}–{usd(t.max, 2)} USDT{t.dailyLimit > 0 ? ` · Today ${usd(t.usedToday, 2)} / ${usd(t.dailyLimit, 2)} USDT` : ""}
      </div>
      {sideOff && <div className="banner warn"><Icon name="alert" size={18} /><span>{side === "buy" ? "Buying" : "Selling"} is currently unavailable.</span></div>}
      <button className="btn block" disabled={busy || !t.enabled || sideOff || n <= 0} onClick={go}>
        {side === "sell" ? "Sell for USDT" : "Buy TFUEL"}
      </button>
    </div>
  );
}

function Deposit({ m, say, done }: { m: M; say: Say; done: () => void }) {
  const [id, setId] = useState(m.deposit.networks[0]?.id || "");
  const [txid, setTxid] = useState("");
  const [amt, setAmt] = useState("");
  const [exact, setExact] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const net = m.deposit.networks.find((n) => n.id === id);
  const auto = !!net?.auto;
  useEffect(() => { setExact(null); }, [id]);
  if (!m.deposit.enabled || !m.deposit.networks.length)
    return <div className="card empty">Deposits aren&apos;t available right now.</div>;
  const getExact = async () => {
    setBusy(true);
    try {
      const r: any = await api("deposit", { action: "intent", network: id, amount: Number(amt) });
      setExact(r.exact);
    } catch (e: any) { say(errText(e)); } finally { setBusy(false); }
  };
  const submit = async () => {
    setBusy(true);
    try {
      const r: any = await api("deposit", { network: id, txid: txid.trim(), amount: Number(amt) });
      say(r.status === "approved" ? `Deposit confirmed: +${r.credited} USDT added.` : auto ? "Submitted. We'll credit it automatically once the network confirms." : "Deposit submitted. We'll credit it after checking.", true);
      setTxid(""); setAmt(""); setExact(null);
      done();
    } catch (e: any) {
      say(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const showAddr = !auto || exact !== null;
  return (
    <div className="card">
      <label style={{ marginTop: 0 }}>Network</label>
      <select value={id} onChange={(e) => setId(e.target.value)}>
        {m.deposit.networks.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
      </select>
      {auto && exact === null && (
        <>
          <label>How much do you want to deposit? (USDT)</label>
          <input inputMode="decimal" placeholder={`Min ${usd(net!.min, 2)}`} value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} />
          <div className="xs muted" style={{ marginTop: 6 }}>We&apos;ll give you an exact amount to send so your deposit is matched and credited automatically.</div>
          <div style={{ marginTop: 14 }}><button className="btn block" disabled={busy || !(Number(amt) >= net!.min)} onClick={getExact}>Continue</button></div>
        </>
      )}
      {net && showAddr && (
        <>
          {auto && exact !== null && (
            <div className="banner warn" style={{ marginTop: 12 }}>
              <Icon name="alert" size={18} />
              <span>Send <b>exactly {exact.toFixed(2)} USDT</b> (not a cent more or less) on <b>{net.name}</b>. Valid for 6 hours.</span>
            </div>
          )}
          <label>Send USDT to this address</label>
          <div className="gap" style={{ background: "var(--soft)", borderRadius: 12, padding: "10px 12px" }}>
            <span className="xs" style={{ wordBreak: "break-all", flex: 1, userSelect: "text", fontWeight: 600 }}>{net.address}</span>
            <button className="btn sec sm" onClick={() => { navigator.clipboard?.writeText(net.address); say("Address copied", true); }}><Icon name="copy" size={14} /></button>
          </div>
          <div className="banner warn"><Icon name="alert" size={18} /><span>Send only USDT on <b>{net.name}</b>. Minimum {usd(net.min, 2)} USDT.{net.note ? ` ${net.note}` : ""} Funds sent on another network can&apos;t be recovered.</span></div>
          <label>After sending, paste the transaction ID (TxID)</label>
          <input placeholder="Transaction hash" value={txid} onChange={(e) => setTxid(e.target.value)} />
          {!auto && (
            <>
              <label>Amount sent (USDT)</label>
              <input inputMode="decimal" placeholder="0.00" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} />
            </>
          )}
          <div style={{ marginTop: 14 }}>
            <button className="btn block" disabled={busy || txid.trim().length < 16 || (!auto && !(Number(amt) > 0))} onClick={submit}>{auto ? "I've sent it — confirm" : "Submit deposit"}</button>
          </div>
        </>
      )}
    </div>
  );
}

function Payout({ m, say, done }: { m: M; say: Say; done: () => void }) {
  const [id, setId] = useState(m.payout.networks[0]?.id || "");
  const [addr, setAddr] = useState("");
  const [amt, setAmt] = useState("");
  const [pin, setPin] = useState("");
  const { a: acct } = useAccount();
  const [busy, setBusy] = useState(false);
  const net = m.payout.networks.find((n) => n.id === id);
  if (!m.payout.enabled || !m.payout.networks.length)
    return <div className="card empty">USDT withdrawals aren&apos;t available right now.</div>;
  const n = Number(amt) || 0;
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<any>("usdt-withdraw", { network: id, address: addr, amount: n, pin });
      say(`Request sent. You'll receive ${usd(r.receive, 2)} USDT.`, true);
      setAmt("");
      setPin("");
      done();
    } catch (e: any) {
      let t = errText(e);
      if (e.message === "below_min_usdt" && e.data?.min) t = `Minimum withdrawal is ${usd(e.data.min, 2)} USDT.`;
      say(t);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <label style={{ marginTop: 0 }}>Network</label>
      <select value={id} onChange={(e) => setId(e.target.value)}>
        {m.payout.networks.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <label>Wallet address</label>
      <AddrPicker acc={acct} onPick={setAddr} />
      <input placeholder="Your USDT address" value={addr} maxLength={100} onChange={(e) => setAddr(e.target.value)} />
      <PinField acc={acct} value={pin} onChange={setPin} />
      <label>Amount (USDT)</label>
      <div style={{ position: "relative" }}>
        <input inputMode="decimal" placeholder={net ? `Min ${usd(net.min, 2)}` : "0.00"} value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} />
        <button className="btn sec sm" style={{ position: "absolute", right: 6, top: 6 }} onClick={() => setAmt(String(Math.floor(m.balances.usdt * 100) / 100))}>Max</button>
      </div>
      {net && (
        <div className="xs muted" style={{ marginTop: 6 }}>
          Network fee {usd(net.fee, 2)} USDT · You&apos;ll receive ≈ {n > net.fee ? usd(n - net.fee, 2) : "0.00"} USDT
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <button className="btn block" disabled={busy || !n || addr.length < 10} onClick={submit}>Request withdrawal</button>
      </div>
      <div className="xs muted" style={{ marginTop: 8 }}>Withdrawals are reviewed and sent manually. Double-check your address — transfers can&apos;t be reversed.</div>
    </div>
  );
}

function History({ m, cpt, say, done }: { m: M; cpt: number; say: Say; done: () => void }) {
  const recheck = async (id: string) => {
    try {
      const r: any = await api("deposit", { action: "recheck", id });
      say(r.status === "approved" ? "Deposit confirmed and credited." : "Not confirmed yet. Please try again in a few minutes.", r.status === "approved");
      done();
    } catch (e: any) { say(errText(e)); }
  };
  const empty = !m.trades.length && !m.deposits.length && !m.payouts.length;
  return (
    <>
      {empty && <div className="card empty">No activity yet.</div>}
      {m.trades.length > 0 && (
        <div className="card">
          <div className="title" style={{ marginBottom: 4 }}>Trades</div>
          {m.trades.map((t) => (
            <div className="hist" key={t.id}>
              <div>
                <div className="title num">{t.side === "sell" ? "Sold" : "Bought"} {fmtTf(t.coins, cpt)} TFUEL</div>
                <div className="sub">{day(t.at)} · @ {px(t.price)}</div>
              </div>
              <b className="num" style={{ color: t.side === "sell" ? "var(--ok)" : "var(--text)" }}>{t.side === "sell" ? "+" : "−"}{usd(t.usdt_u / 1e6, 2)} USDT</b>
            </div>
          ))}
        </div>
      )}
      {m.deposits.length > 0 && (
        <div className="card">
          <div className="title" style={{ marginBottom: 4 }}>Deposits</div>
          {m.deposits.map((d) => (
            <div className="hist" key={d.id}>
              <div><div className="title num">{usd(d.credited ?? d.amount, 2)} USDT</div><div className="sub">{d.network_name} · {day(d.created_at)}{d.note ? ` · ${d.note}` : ""}</div></div>
              <div style={{ textAlign: "right" }}>
                <span className={`pill ${stCls(d.status)}`}>{cap(d.status)}</span>
                {d.status === "pending" && d.auto && <div><button className="btn sec sm" style={{ marginTop: 6 }} onClick={() => recheck(d.id)}>Check again</button></div>}
              </div>
            </div>
          ))}
        </div>
      )}
      {m.payouts.length > 0 && (
        <div className="card">
          <div className="title" style={{ marginBottom: 4 }}>USDT withdrawals</div>
          {m.payouts.map((d) => (
            <div className="hist" key={d.id}>
              <div><div className="title num">{usd(d.receive, 2)} USDT</div><div className="sub">{d.network_name} · {day(d.created_at)}{d.note ? ` · ${d.note}` : ""}</div></div>
              <span className={`pill ${stCls(d.status)}`}>{cap(d.status)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------- Limit orders + price alerts ---------------- */
interface Ord { id: string; side: "buy" | "sell"; coins: number; usdt: number; limit: number; status: string; price: number | null; at: number }
interface Alrt { id: string; price: number; dir: "above" | "below"; at: number }

function Orders({ m, cpt, say, done }: { m: M; cpt: number; say: Say; done: () => void }) {
  const [side, setSide] = useState<"buy" | "sell">("sell");
  const [amt, setAmt] = useState("");
  const [lim, setLim] = useState("");
  const [orders, setOrders] = useState<Ord[]>([]);
  const [alerts, setAlerts] = useState<Alrt[]>([]);
  const [ap, setAp] = useState("");
  const [busy, setBusy] = useState(false);
  const price = m.price?.value || 0;
  const fee = m.trade.feePct / 100;

  const refresh = useCallback(async () => {
    try {
      const [o, a] = await Promise.all([api<any>("orders", { action: "list" }), api<any>("alerts", { action: "list" })]);
      setOrders(o.orders || []);
      setAlerts(a.alerts || []);
    } catch {}
  }, []);
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 15000);
    return () => clearInterval(iv);
  }, [refresh]);

  const n = Number(amt) || 0;
  const l = Number(lim) || 0;
  const est = n > 0 && l > 0 ? (side === "sell" ? `${usd(n * l * (1 - fee), 4)} USDT` : `${fmtTf(Math.floor(((n * (1 - fee)) / l) * cpt), cpt)} TFUEL`) : "—";
  const preset = (pct: number) => price && setLim((price * (1 + pct / 100)).toFixed(price < 0.1 ? 5 : 4));

  const place = async () => {
    setBusy(true);
    try {
      const r = await api<any>("orders", { action: "place", side, amount: n, limit: l });
      setOrders(r.orders || []);
      setAmt("");
      say("Order placed. It fills automatically when the price is reached.", true);
      done();
    } catch (e: any) {
      say(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (id: string) => {
    try {
      const r = await api<any>("orders", { action: "cancel", id });
      setOrders(r.orders || []);
      say("Order cancelled. Your funds were returned.", true);
      done();
    } catch (e: any) {
      say(errText(e));
    }
  };
  const addAlert = async () => {
    try {
      const r = await api<any>("alerts", { action: "add", price: Number(ap) });
      setAlerts(r.alerts || []);
      setAp("");
      say("Alert set. We'll message you on Telegram.", true);
    } catch (e: any) {
      say(errText(e));
    }
  };
  const rmAlert = async (id: string) => {
    try {
      setAlerts((await api<any>("alerts", { action: "remove", id })).alerts || []);
    } catch (e: any) {
      say(errText(e));
    }
  };

  const open = orders.filter((o) => o.status === "open");
  const past = orders.filter((o) => o.status !== "open").slice(0, 6);
  const enabled = m.orders?.enabled !== false && m.trade.enabled;

  return (
    <>
      <div className="card">
        <div className="title">Limit order</div>
        <div className="sub">Set a price. We buy or sell for you automatically when the market reaches it.</div>
        {!enabled && <div className="banner warn"><Icon name="alert" size={18} /><span>Limit orders are unavailable right now.</span></div>}
        <div className="seg" style={{ marginTop: 10 }}>
          <button className={side === "sell" ? "on" : ""} onClick={() => { setSide("sell"); setAmt(""); setLim(""); }}>Sell high</button>
          <button className={side === "buy" ? "on" : ""} onClick={() => { setSide("buy"); setAmt(""); setLim(""); }}>Buy low</button>
        </div>
        <label style={{ marginTop: 0 }}>{side === "sell" ? "TFUEL to sell" : "USDT to spend"}</label>
        <div style={{ position: "relative" }}>
          <input inputMode="decimal" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} />
          <button className="btn sec sm" style={{ position: "absolute", right: 6, top: 6 }} onClick={() => setAmt(side === "sell" ? String(Math.floor(m.balances.coins) / cpt) : String(Math.floor(m.balances.usdt * 100) / 100))}>Max</button>
        </div>
        <label>{side === "sell" ? "Sell when price reaches (USDT)" : "Buy when price drops to (USDT)"}</label>
        <input inputMode="decimal" placeholder={price ? `Now ${px(price)}` : "Price"} value={lim} onChange={(e) => setLim(e.target.value.replace(/[^\d.]/g, ""))} />
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {(side === "sell" ? [3, 5, 10, 20] : [-3, -5, -10, -20]).map((p) => (
            <button key={p} className="btn sec sm" style={{ flex: 1 }} onClick={() => preset(p)}>{p > 0 ? "+" : ""}{p}%</button>
          ))}
        </div>
        <div className="row sm" style={{ margin: "12px 0" }}><span className="muted">You receive ≈</span><b className="num">{est}</b></div>
        <div className="xs muted" style={{ marginBottom: 10 }}>
          {side === "sell" ? "Your TFUEL is set aside until the order fills or you cancel." : "Your USDT is set aside until the order fills or you cancel."} Fee {m.trade.feePct}% · up to {m.orders?.max ?? 5} open orders.
        </div>
        <button className="btn block" disabled={busy || !enabled || n <= 0 || l <= 0} onClick={place}>Place {side === "sell" ? "sell" : "buy"} order</button>
      </div>

      {(open.length > 0 || past.length > 0) && (
        <div className="card">
          <div className="title" style={{ marginBottom: 4 }}>My orders</div>
          {open.map((o) => (
            <div className="hist" key={o.id}>
              <div>
                <div className="title num" style={{ fontSize: 14 }}>{o.side === "sell" ? `Sell ${fmtTf(o.coins, cpt)} TFUEL` : `Buy with ${usd(o.usdt, 2)} USDT`}</div>
                <div className="sub num">at {o.side === "sell" ? "≥" : "≤"} {px(o.limit)} · {day(o.at)}</div>
              </div>
              <button className="btn sec sm" onClick={() => cancel(o.id)}>Cancel</button>
            </div>
          ))}
          {past.map((o) => (
            <div className="hist" key={o.id}>
              <div>
                <div className="title num" style={{ fontSize: 14 }}>{o.side === "sell" ? `Sell ${fmtTf(o.coins, cpt)} TFUEL` : `Buy with ${usd(o.usdt, 2)} USDT`}</div>
                <div className="sub num">{o.status === "filled" && o.price ? `filled at ${px(o.price)}` : `limit ${px(o.limit)}`} · {day(o.at)}</div>
              </div>
              <span className={`pill ${o.status === "filled" ? "ok" : ""}`}>{cap(o.status)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="title">Price alerts</div>
        <div className="sub">Get a Telegram message when TFUEL reaches your price. Make sure you've started the bot.</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input inputMode="decimal" placeholder={price ? `Now ${px(price)}` : "Target price"} value={ap} onChange={(e) => setAp(e.target.value.replace(/[^\d.]/g, ""))} />
          <button className="btn" disabled={!(Number(ap) > 0)} onClick={addAlert}>Add</button>
        </div>
        {alerts.map((a) => (
          <div className="hist" key={a.id}>
            <div>
              <div className="title num" style={{ fontSize: 14 }}>{a.dir === "above" ? "Rises to" : "Falls to"} {px(a.price)}</div>
              <div className="sub">{day(a.at)}</div>
            </div>
            <button className="btn sec sm" onClick={() => rmAlert(a.id)}>Remove</button>
          </div>
        ))}
        {alerts.length === 0 && <div className="xs muted" style={{ marginTop: 8 }}>No alerts yet.</div>}
      </div>
    </>
  );
}

/** Profile থেকে খোলে: Deposit / Withdraw (TFUEL ট্যাবে নয়) */
function useMarket(say: Say) {
  const [m, setM] = useState<M | null>(null);
  const load = useCallback(async () => { try { setM(await api<M>("market")); } catch (e: any) { say(errText(e)); } }, [say]);
  useEffect(() => { load(); }, [load]);
  return { m, load };
}
export function DepositBox({ say, reload }: { say: Say; reload: () => void }) {
  const { m, load } = useMarket(say);
  if (!m) return <div className="card empty">Loading…</div>;
  return <Deposit m={m} say={say} done={() => { load(); reload(); }} />;
}
export function PayoutBox({ say, reload }: { say: Say; reload: () => void }) {
  const { m, load } = useMarket(say);
  if (!m) return <div className="card empty">Loading…</div>;
  return <Payout m={m} say={say} done={() => { load(); reload(); }} />;
}
