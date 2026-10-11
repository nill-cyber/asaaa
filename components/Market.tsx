import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { api, errText, fmtTf, fmtUsd } from "@/lib/client";
import Icon from "@/components/Icons";
import Logo from "@/components/Logo";

type Say = (t: string, ok?: boolean) => void;
type Candle = [number, number, number, number, number];
interface M {
  price: { value: number; stale: boolean; at: number } | null;
  trade: { enabled: boolean; paused: string | null; buy: boolean; sell: boolean; feePct: number; min: number; max: number; dailyLimit: number; usedToday: number; coinsPerTfuel: number };
  balances: { coins: number; usdt: number };
  deposit: { enabled: boolean; networks: { id: string; name: string; address: string; min: number; note: string }[] };
  payout: { enabled: boolean; networks: { id: string; name: string; min: number; fee: number }[] };
  trades: { id: string; side: string; coins: number; usdt_u: number; price: number; at: number }[];
  deposits: { id: string; network_name: string; amount: number; status: string; credited?: number; created_at: number; note?: string }[];
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

/* ---------------- Live chart: line / candle ---------------- */
function PriceChart({ live, onChange }: { live: number; onChange: (c: number) => void }) {
  const gid = "c" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [mode, setMode] = useState<"line" | "candle">(() => (store("chart_mode") === "candle" ? "candle" : "line"));
  const [range, setRange] = useState<"1d" | "7d" | "30d">("1d");
  const [data, setData] = useState<{ pts: [number, number][]; candles: Candle[] } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    setData(null);
    let dead = false;
    const go = () =>
      api<any>("market-chart", { range })
        .then((d) => !dead && setData({ pts: d.pts || [], candles: d.candles || [] }))
        .catch(() => {});
    go();
    const iv = setInterval(go, 120000);
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
  const series = view ? (mode === "candle" ? view.candles : view.pts) : [];
  const n = series.length;

  let body: React.ReactNode = null;
  let lo = 0, hi = 1;
  if (view && n > 2) {
    if (mode === "candle") {
      lo = Math.min(...view.candles.map((c) => c[3]));
      hi = Math.max(...view.candles.map((c) => c[2]));
    } else {
      const ys = view.pts.map((p) => p[1]);
      lo = Math.min(...ys);
      hi = Math.max(...ys);
    }
    const pad = (hi - lo) * 0.08 || hi * 0.01;
    lo -= pad;
    hi += pad;
    const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
    const slot = cw / n;
    const x = (i: number) => slot * i + slot / 2;
    if (mode === "line") {
      const line = view.pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
      body = (
        <>
          <path d={`${line} L${x(n - 1)},${H} L${x(0)},${H} Z`} fill={`url(#${gid})`} />
          <path d={line} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </>
      );
    } else {
      const bw = Math.max(1.5, Math.min(10, slot * 0.7));
      body = view.candles.map((c, i) => {
        const g = c[4] >= c[1];
        const k = g ? "#16a34a" : "#e5484d";
        const top = y(Math.max(c[1], c[4])), bot = y(Math.min(c[1], c[4]));
        return (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={y(c[2])} y2={y(c[3])} stroke={k} strokeWidth="1.2" />
            <rect x={x(i) - bw / 2} y={top} width={bw} height={Math.max(1.5, bot - top)} fill={k} rx="1" />
          </g>
        );
      });
    }
  }

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || n < 3) return;
    const rel = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.floor((rel / cw) * n))));
  };
  const h = hover !== null && view ? (mode === "candle" ? view.candles[hover] : null) : null;
  const hp = hover !== null && view && mode === "line" ? view.pts[hover] : null;
  const grid = [0, 0.5, 1].map((f) => ({ f, v: hi - (hi - lo) * f }));

  return (
    <div>
      <div className="row" style={{ margin: "8px 0 4px" }}>
        <div className="seg" style={{ margin: 0, padding: 2 }}>
          {(["1d", "7d", "30d"] as const).map((r) => (
            <button key={r} className={range === r ? "on" : ""} style={{ padding: "5px 10px" }} onClick={() => setRange(r)}>{r === "1d" ? "24H" : r === "7d" ? "7D" : "30D"}</button>
          ))}
        </div>
        <div className="seg" style={{ margin: 0, padding: 2 }}>
          {(["line", "candle"] as const).map((k) => (
            <button key={k} className={mode === k ? "on" : ""} style={{ padding: "5px 10px" }} onClick={() => { setMode(k); store("chart_mode", k); }}>{k === "line" ? "Line" : "Candles"}</button>
          ))}
        </div>
      </div>
      <div className="xs num" style={{ height: 16, color: "var(--muted)" }}>
        {h ? `${new Date(h[0]).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · O ${px(h[1])} H ${px(h[2])} L ${px(h[3])} C ${px(h[4])}` : hp ? `${new Date(hp[0]).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${px(hp[1])}` : ""}
      </div>
      {!view || n < 3 ? (
        <div className="empty" style={{ padding: 40 }}>{view ? "Chart will appear shortly" : "Loading chart…"}</div>
      ) : (
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", touchAction: "pan-y" }} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} onPointerUp={() => setHover(null)}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={col} stopOpacity=".22" />
              <stop offset="1" stopColor={col} stopOpacity="0" />
            </linearGradient>
          </defs>
          {grid.map((g) => (
            <g key={g.f}>
              <line x1="0" x2={cw} y1={PT + g.f * (H - PT - PB)} y2={PT + g.f * (H - PT - PB)} stroke="#e7ebf3" strokeDasharray="3 4" />
              <text x={W - 2} y={PT + g.f * (H - PT - PB) + (g.f === 0 ? 10 : g.f === 1 ? -3 : 3)} textAnchor="end" fontSize="9" fill="#6b7690">{g.v.toFixed(g.v < 0.1 ? 4 : 2)}</text>
            </g>
          ))}
          {body}
          {hover !== null && <line x1={(cw / n) * hover + cw / n / 2} x2={(cw / n) * hover + cw / n / 2} y1={PT} y2={H - PB} stroke="#6b7690" strokeOpacity=".5" />}
        </svg>
      )}
    </div>
  );
}

export default function Market({ say, reload, cpt }: { say: Say; reload: () => void; cpt: number }) {
  const [m, setM] = useState<M | null>(null);
  const [change, setChange] = useState(0);
  const [sub, setSub] = useState<"trade" | "deposit" | "withdraw" | "history">("trade");

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
      <div className="card" style={{ paddingBottom: 8 }}>
        <div className="row">
          <div className="left">
            <Logo size={36} />
            <div>
              <div className="title">TFUEL</div>
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
          <div className="sub">TFUEL</div>
          <div className="title num" style={{ fontSize: 18 }}>{fmtTf(m.balances.coins, cpt)}</div>
          <div className="xs muted">≈ {fmtUsd((m.balances.coins / cpt) * price)}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="sub">USDT</div>
          <div className="title num" style={{ fontSize: 18 }}>{usd(m.balances.usdt, 2)}</div>
          <div className="xs muted">Available</div>
        </div>
      </div>

      <div className="seg">
        {(["trade", "deposit", "withdraw", "history"] as const).map((k) => (
          <button key={k} className={sub === k ? "on" : ""} onClick={() => setSub(k)}>{cap(k)}</button>
        ))}
      </div>

      {sub === "trade" && <Trade m={m} cpt={cpt} say={say} done={done} />}
      {sub === "deposit" && <Deposit m={m} say={say} done={done} />}
      {sub === "withdraw" && <Payout m={m} say={say} done={done} />}
      {sub === "history" && <History m={m} cpt={cpt} />}
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
  const [busy, setBusy] = useState(false);
  const net = m.deposit.networks.find((n) => n.id === id);
  if (!m.deposit.enabled || !m.deposit.networks.length)
    return <div className="card empty">Deposits aren&apos;t available right now.</div>;
  const submit = async () => {
    setBusy(true);
    try {
      await api("deposit", { network: id, txid: txid.trim(), amount: Number(amt) });
      say("Deposit submitted. We'll credit it after checking.", true);
      setTxid("");
      setAmt("");
      done();
    } catch (e: any) {
      say(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <label style={{ marginTop: 0 }}>Network</label>
      <select value={id} onChange={(e) => setId(e.target.value)}>
        {m.deposit.networks.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
      </select>
      {net && (
        <>
          <label>Send USDT to this address</label>
          <div className="gap" style={{ background: "var(--soft)", borderRadius: 12, padding: "10px 12px" }}>
            <span className="xs" style={{ wordBreak: "break-all", flex: 1, userSelect: "text", fontWeight: 600 }}>{net.address}</span>
            <button className="btn sec sm" onClick={() => { navigator.clipboard?.writeText(net.address); say("Address copied", true); }}><Icon name="copy" size={14} /></button>
          </div>
          <div className="banner warn"><Icon name="alert" size={18} /><span>Send only USDT on <b>{net.name}</b>. Minimum {usd(net.min, 2)} USDT.{net.note ? ` ${net.note}` : ""} Funds sent on another network can&apos;t be recovered.</span></div>
        </>
      )}
      <label>After sending, paste the transaction ID (TxID)</label>
      <input placeholder="Transaction hash" value={txid} onChange={(e) => setTxid(e.target.value)} />
      <label>Amount sent (USDT)</label>
      <input inputMode="decimal" placeholder="0.00" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} />
      <div style={{ marginTop: 14 }}>
        <button className="btn block" disabled={busy || txid.trim().length < 16 || !(Number(amt) > 0)} onClick={submit}>Submit deposit</button>
      </div>
    </div>
  );
}

function Payout({ m, say, done }: { m: M; say: Say; done: () => void }) {
  const [id, setId] = useState(m.payout.networks[0]?.id || "");
  const [addr, setAddr] = useState("");
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const net = m.payout.networks.find((n) => n.id === id);
  if (!m.payout.enabled || !m.payout.networks.length)
    return <div className="card empty">USDT withdrawals aren&apos;t available right now.</div>;
  const n = Number(amt) || 0;
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<any>("usdt-withdraw", { network: id, address: addr, amount: n });
      say(`Request sent. You'll receive ${usd(r.receive, 2)} USDT.`, true);
      setAmt("");
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
      <input placeholder="Your USDT address" value={addr} maxLength={100} onChange={(e) => setAddr(e.target.value)} />
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

function History({ m, cpt }: { m: M; cpt: number }) {
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
              <span className={`pill ${stCls(d.status)}`}>{cap(d.status)}</span>
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
