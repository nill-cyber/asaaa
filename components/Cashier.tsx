import { useCallback, useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { api, errText, fmtUsd, tg } from "@/lib/client";
import Icon from "@/components/Icons";
import Logo from "@/components/Logo";
import { useAccount, PinField, AddrPicker } from "@/components/Settings";

type Say = (t: string, ok?: boolean) => void;
interface Net { id: string; name: string; address: string; min: number; note: string; auto?: boolean }
export interface CashM {
  balances: { coins: number; usdt: number };
  deposit: { enabled: boolean; networks: Net[]; binanceId: { id: string; min: number } | null; stars: { per: number; min: number; max: number } | null };
  payout: { enabled: boolean; networks: { id: string; name: string; min: number; fee: number }[] };
  deposits: { id: string; network_name: string; amount: number; status: string; credited?: number; created_at: number; note?: string; auto?: boolean; auto_note?: string }[];
  payouts: { id: string; network_name: string; address?: string; amount: number; receive: number; fee?: number; status: string; created_at: number; note?: string }[];
}

const usd = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const when = (t: number) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const stCls = (s: string) => (s === "paid" || s === "approved" ? "ok" : s === "rejected" ? "err" : "warn");
const stLabel = (s: string) => (s === "approved" ? "Credited" : s === "paid" ? "Paid" : s === "rejected" ? "Rejected" : "Pending");
const short = (a: string) => (a.length > 16 ? a.slice(0, 7) + "…" + a.slice(-6) : a);

export function useCash(say: Say) {
  const [m, setM] = useState<CashM | null>(null);
  const load = useCallback(async () => {
    try { setM(await api<CashM>("market")); } catch (e: any) { say(errText(e)); }
  }, [say]);
  useEffect(() => { load(); }, [load]);
  return { m, load };
}

export function PageHead({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <div className="pghead">
      <button className="back" aria-label="Back" onClick={onBack}><Icon name="chevron" size={20} /></button>
      <h2 style={{ flex: 1 }}>{title}</h2>
      {right}
    </div>
  );
}

export function Qr({ text, size = 190 }: { text: string; size?: number }) {
  const svg = useMemo(() => {
    try {
      const q = qrcode(0, "M");
      q.addData(text);
      q.make();
      return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch { return ""; }
  }, [text]);
  if (!svg) return null;
  return <div className="qrbox" style={{ width: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Copy({ text, say, label }: { text: string; say: Say; label?: string }) {
  return (
    <button className="btn sec sm" onClick={() => { try { navigator.clipboard?.writeText(text); } catch {} say("Copied", true); }}>
      <Icon name="copy" size={14} />{label}
    </button>
  );
}

function Countdown({ until }: { until: number }) {
  const [, f] = useState(0);
  useEffect(() => { const i = setInterval(() => f((n) => n + 1), 1000); return () => clearInterval(i); }, []);
  const s = Math.max(0, Math.floor((until - Date.now()) / 1000));
  return <span className="num">{String(Math.floor(s / 3600)).padStart(2, "0")}:{String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:{String(s % 60).padStart(2, "0")}</span>;
}

/** Submitted → Confirming → Credited */
function Tracker({ status }: { status: string }) {
  const stage = status === "approved" ? 2 : status === "rejected" ? -1 : 1;
  const steps = ["Submitted", "Confirming", "Credited"];
  return (
    <div className="track">
      {steps.map((s, i) => (
        <div key={s} style={{ display: "contents" }}>
          <div className={`st ${i < stage || stage === 2 ? "done" : i === stage ? "now" : ""}`}><i>{i < stage || stage === 2 ? <Icon name="check" size={14} /> : i + 1}</i>{s}</div>
          {i < 2 && <div className="ln" />}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Deposit ------------------------------ */
type Method = "crypto" | "binance" | "stars";

export function DepositPage({ say, reload, onBack, onHistory }: { say: Say; reload: () => void; onBack: () => void; onHistory: () => void }) {
  const { m, load } = useCash(say);
  const methods = useMemo(() => {
    const r: { k: Method; t: string; s: string }[] = [];
    if (m?.deposit.enabled && m.deposit.networks.length) r.push({ k: "crypto", t: "Crypto", s: "USDT on-chain" });
    if (m?.deposit.binanceId) r.push({ k: "binance", t: "Binance ID", s: "No fee" });
    if (m?.deposit.stars) r.push({ k: "stars", t: "Stars", s: "Telegram" });
    return r;
  }, [m]);
  const [method, setMethod] = useState<Method | null>(null);
  const cur = method && methods.find((x) => x.k === method) ? method : methods[0]?.k;
  const done = () => { load(); reload(); };

  return (
    <>
      <PageHead title="Deposit" onBack={onBack} right={<button className="btn sec sm" onClick={onHistory}><Icon name="clock" size={14} /> History</button>} />
      {!m && <div className="card empty">Loading…</div>}
      {m && (
        <>
          <div className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Logo kind="usdt" size={40} />
            <div style={{ flex: 1 }}>
              <div className="sub" style={{ marginTop: 0 }}>USDT balance</div>
              <div className="title num" style={{ fontSize: 22 }}>{usd(m.balances.usdt)} <span className="muted" style={{ fontSize: 13 }}>USDT</span></div>
            </div>
          </div>
          {methods.length === 0 && <div className="card empty">Deposits aren&apos;t available right now.</div>}
          {methods.length > 1 && (
            <div className="mtabs">
              {methods.map((x) => <button key={x.k} className={cur === x.k ? "on" : ""} onClick={() => setMethod(x.k)}>{x.t}<small>{x.s}</small></button>)}
            </div>
          )}
          {cur === "crypto" && <CryptoDeposit m={m} say={say} done={done} />}
          {cur === "binance" && m.deposit.binanceId && <BinanceDeposit id={m.deposit.binanceId.id} min={m.deposit.binanceId.min} say={say} done={done} />}
          {cur === "stars" && m.deposit.stars && <StarsDeposit cfg={m.deposit.stars} say={say} done={done} />}
          <RecentDeposits m={m} say={say} done={done} />
        </>
      )}
    </>
  );
}

/** auto-মোডে: পরিমাণ → অনন্য পরিমাণ → পাঠান → confirm; ম্যানুয়াল মোডে: ঠিকানা + TxID */
function useIntent(netId: string, say: Say) {
  const [amt, setAmt] = useState("");
  const [exact, setExact] = useState<{ v: number; exp: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setExact(null); }, [netId]);
  const get = async () => {
    setBusy(true);
    try { const r: any = await api("deposit", { action: "intent", network: netId, amount: Number(amt) }); setExact({ v: r.exact, exp: r.expires_at }); }
    catch (e: any) { say(errText(e)); } finally { setBusy(false); }
  };
  return { amt, setAmt, exact, setExact, busy, setBusy, get };
}

function Steps({ items }: { items: string[] }) {
  return <ol className="steps">{items.map((s, i) => <li key={i}>{s}</li>)}</ol>;
}

function CryptoDeposit({ m, say, done }: { m: CashM; say: Say; done: () => void }) {
  const nets = m.deposit.networks;
  const [id, setId] = useState(nets[0]?.id || "");
  const net = nets.find((n) => n.id === id) || nets[0];
  const auto = !!net?.auto;
  const it = useIntent(id, say);
  const [txid, setTxid] = useState("");
  const [sent, setSent] = useState("");
  const [sub, setSub] = useState<{ id: string; status: string } | null>(null);
  useEffect(() => { setSub(null); setTxid(""); }, [id]);
  if (!net) return null;

  const submit = async () => {
    it.setBusy(true);
    try {
      const r: any = await api("deposit", { network: net.id, txid: txid.trim(), amount: Number(auto ? it.amt : sent) });
      setSub({ id: r.id, status: r.status });
      if (r.status === "approved") say(`Deposit confirmed: +${r.credited} USDT added.`, true);
      else say("Submitted. We'll credit it automatically once the network confirms.", true);
      setTxid(""); it.setAmt(""); it.setExact(null); done();
    } catch (e: any) { say(errText(e)); } finally { it.setBusy(false); }
  };

  const showAddr = !auto || it.exact !== null;
  return (
    <div className="card">
      <div className="title" style={{ marginBottom: 4 }}>Select network</div>
      <div className="chips">
        {nets.map((n) => <button key={n.id} className={`chip ${n.id === id ? "on" : ""}`} onClick={() => setId(n.id)}>{n.name}</button>)}
      </div>

      {sub && <PendingBox id={sub.id} status={sub.status} say={say} done={() => { done(); }} onClose={() => setSub(null)} />}

      {!sub && auto && it.exact === null && (
        <>
          <label>How much do you want to deposit? (USDT)</label>
          <input inputMode="decimal" placeholder={`Minimum ${usd(net.min)}`} value={it.amt} onChange={(e) => it.setAmt(e.target.value.replace(/[^\d.]/g, ""))} />
          <div className="quick">{[10, 25, 50, 100].map((v) => <button key={v} onClick={() => it.setAmt(String(v))}>{v}</button>)}</div>
          <div className="xs muted" style={{ marginTop: 8 }}>You&apos;ll get a unique amount to send, so your deposit is matched and credited automatically — no TxID needed.</div>
          <div style={{ marginTop: 14 }}><button className="btn block" disabled={it.busy || !(Number(it.amt) >= net.min)} onClick={it.get}>Continue</button></div>
        </>
      )}

      {!sub && showAddr && (
        <>
          {auto && it.exact && (
            <div className="amtbox">
              <div className="xs">Send exactly</div>
              <div className="big num">{it.exact.v.toFixed(2)} USDT</div>
              <div className="xs">Valid for <Countdown until={it.exact.exp} /> · not a cent more or less</div>
              <div style={{ marginTop: 8 }}><Copy text={it.exact.v.toFixed(2)} say={say} label=" Copy amount" /></div>
            </div>
          )}
          <Qr text={net.address} />
          <div className="xs muted" style={{ textAlign: "center", marginBottom: 8 }}>Scan with your wallet or exchange app</div>
          <div className="addrbox"><span>{net.address}</span><Copy text={net.address} say={say} /></div>
          <div className="banner warn"><Icon name="alert" size={18} /><span>Send only <b>USDT</b> on <b>{net.name}</b>. Minimum {usd(net.min)} USDT.{net.note ? ` ${net.note}` : ""} Other networks can&apos;t be recovered.</span></div>
          {!auto && (
            <>
              <label>Amount sent (USDT)</label>
              <input inputMode="decimal" placeholder="0.00" value={sent} onChange={(e) => setSent(e.target.value.replace(/[^\d.]/g, ""))} />
            </>
          )}
          <label>{auto ? "Transaction ID (optional — speeds things up)" : "Transaction ID (TxID)"}</label>
          <input placeholder="Paste the transaction hash" value={txid} onChange={(e) => setTxid(e.target.value)} />
          <div style={{ marginTop: 14 }}>
            <button className="btn block" disabled={it.busy || (!auto && (txid.trim().length < 16 || !(Number(sent) > 0)))} onClick={submit}>{auto ? "I've sent it" : "Submit deposit"}</button>
          </div>
          <Steps items={auto ? ["Send the exact amount to the address above.", "Tap “I've sent it”. We watch the network and credit you automatically.", "Usually takes 1–10 minutes depending on the network."] : ["Send USDT to the address above.", "Paste the TxID and the amount you sent.", "We check it and credit your wallet."]} />
        </>
      )}
    </div>
  );
}

function BinanceDeposit({ id: bid, min, say, done }: { id: string; min: number; say: Say; done: () => void }) {
  const it = useIntent("binance-id", say);
  const [oid, setOid] = useState("");
  const [sub, setSub] = useState<{ id: string; status: string } | null>(null);
  const submit = async () => {
    it.setBusy(true);
    try {
      const r: any = await api("deposit", { network: "binance-id", txid: oid.trim() });
      setSub({ id: r.id, status: r.status });
      say(r.status === "approved" ? `Deposit confirmed: +${r.credited} USDT added.` : "Submitted. We're looking for your transfer.", true);
      setOid(""); it.setAmt(""); it.setExact(null); done();
    } catch (e: any) { say(errText(e)); } finally { it.setBusy(false); }
  };
  return (
    <div className="card">
      <div className="row"><div className="left"><div className="ico"><Icon name="send" /></div><div><div className="title">Binance ID transfer</div><div className="sub">Instant · no network fee</div></div></div></div>
      {sub && <PendingBox id={sub.id} status={sub.status} say={say} done={done} onClose={() => setSub(null)} />}
      {!sub && it.exact === null && (
        <>
          <label>How much do you want to deposit? (USDT)</label>
          <input inputMode="decimal" placeholder={`Minimum ${usd(min)}`} value={it.amt} onChange={(e) => it.setAmt(e.target.value.replace(/[^\d.]/g, ""))} />
          <div className="quick">{[5, 10, 25, 50].map((v) => <button key={v} onClick={() => it.setAmt(String(v))}>{v}</button>)}</div>
          <div style={{ marginTop: 14 }}><button className="btn block" disabled={it.busy || !(Number(it.amt) >= min)} onClick={it.get}>Continue</button></div>
        </>
      )}
      {!sub && it.exact && (
        <>
          <div className="amtbox">
            <div className="xs">Send exactly</div>
            <div className="big num">{it.exact.v.toFixed(2)} USDT</div>
            <div className="xs">Valid for <Countdown until={it.exact.exp} /></div>
            <div style={{ marginTop: 8 }}><Copy text={it.exact.v.toFixed(2)} say={say} label=" Copy amount" /></div>
          </div>
          <Qr text={bid} />
          <div className="xs muted" style={{ textAlign: "center" }}>Binance ID</div>
          <div className="addrbox" style={{ marginTop: 4 }}><span className="num" style={{ fontSize: 18 }}>{bid}</span><Copy text={bid} say={say} /></div>
          <label>Order ID (optional)</label>
          <input placeholder="Binance transfer order ID" value={oid} onChange={(e) => setOid(e.target.value)} />
          <div style={{ marginTop: 14 }}><button className="btn block" disabled={it.busy} onClick={submit}>I&apos;ve sent it</button></div>
          <Steps items={["Open Binance → Pay → Send (or Transfer).", `Choose “Binance ID / Pay ID” and enter ${bid}.`, `Send exactly ${it.exact.v.toFixed(2)} USDT (the amount must match).`, "Come back and tap “I've sent it”."]} />
        </>
      )}
    </div>
  );
}

function StarsDeposit({ cfg, say, done }: { cfg: { per: number; min: number; max: number }; say: Say; done: () => void }) {
  const [amt, setAmt] = useState("5");
  const [busy, setBusy] = useState(false);
  const n = Number(amt) || 0;
  const stars = Math.ceil(n * cfg.per);
  const ok = n >= cfg.min && n <= cfg.max;
  const pay = async () => {
    setBusy(true);
    try {
      const r: any = await api("deposit", { action: "stars", amount: n });
      const w: any = tg();
      if (!w?.openInvoice) { say("Open the app inside Telegram to pay with Stars."); return; }
      w.openInvoice(r.link, (st: string) => {
        if (st === "paid") { say("Payment received — your balance updates in a moment.", true); setTimeout(done, 1500); setTimeout(done, 5000); }
        else if (st === "failed") say("Payment failed. Please try again.");
      });
    } catch (e: any) {
      say(e.message === "stars_range" ? `Choose between ${cfg.min} and ${cfg.max} USDT.` : errText(e));
    } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <div className="row"><div className="left"><div className="ico" style={{ background: "#fff3d1" }}>⭐</div><div><div className="title">Pay with Telegram Stars</div><div className="sub">Instant · pay inside Telegram</div></div></div></div>
      <label>Amount (USDT)</label>
      <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} />
      <div className="quick">{[1, 5, 10, 25].filter((v) => v >= cfg.min && v <= cfg.max).map((v) => <button key={v} onClick={() => setAmt(String(v))}>{v}</button>)}</div>
      <div className="amtbox" style={{ marginTop: 12 }}>
        <div className="xs">You pay</div>
        <div className="big num">⭐ {ok ? stars.toLocaleString("en-US") : "—"}</div>
        <div className="xs">to receive {ok ? usd(n) : "—"} USDT · 1 USDT = {cfg.per} Stars</div>
      </div>
      <div className="xs muted">Min {cfg.min} · Max {cfg.max} USDT per payment.</div>
      <div style={{ marginTop: 14 }}><button className="btn block" disabled={busy || !ok} onClick={pay}>Pay with Stars</button></div>
    </div>
  );
}

/** pending deposit-এর অবস্থা + ১৫ সেকেন্ড পরপর নিজে recheck */
function PendingBox({ id, status, say, done, onClose }: { id: string; status: string; say: Say; done: () => void; onClose: () => void }) {
  const [st, setSt] = useState(status);
  const [n, setN] = useState(0);
  const check = useCallback(async (quiet = true) => {
    try {
      const r: any = await api("deposit", { action: "recheck", id });
      setSt(r.status === "approved" ? "approved" : "pending");
      if (r.status === "approved") { say("Deposit confirmed and credited.", true); done(); }
      else if (!quiet) say("Not confirmed yet — we'll keep checking.");
    } catch {}
  }, [id, say, done]);
  useEffect(() => {
    if (st === "approved" || n > 40) return;
    const t = setTimeout(() => { setN(n + 1); check(); }, 15000);
    return () => clearTimeout(t);
  }, [st, n, check]);
  return (
    <div style={{ marginTop: 12 }}>
      <Tracker status={st} />
      <div className="banner" style={{ marginTop: 8 }}>
        <Icon name={st === "approved" ? "check" : "clock"} size={18} />
        <span>{st === "approved" ? "Your deposit has been credited." : "Waiting for confirmation. This page checks automatically — you can also close it, we'll notify you."}</span>
      </div>
      <div className="grid2" style={{ marginTop: 10 }}>
        {st !== "approved" && <button className="btn sec" onClick={() => check(false)}><Icon name="refresh" size={14} /> Check now</button>}
        <button className="btn" onClick={onClose}>{st === "approved" ? "Done" : "New deposit"}</button>
      </div>
    </div>
  );
}

function RecentDeposits({ m, say, done }: { m: CashM; say: Say; done: () => void }) {
  const [busy, setBusy] = useState("");
  if (!m.deposits.length) return null;
  const recheck = async (id: string) => {
    setBusy(id);
    try { const r: any = await api("deposit", { action: "recheck", id }); say(r.status === "approved" ? "Deposit confirmed and credited." : "Not confirmed yet. Try again in a few minutes.", r.status === "approved"); done(); }
    catch (e: any) { say(errText(e)); } finally { setBusy(""); }
  };
  return (
    <div className="card">
      <div className="title" style={{ marginBottom: 4 }}>Recent deposits</div>
      {m.deposits.slice(0, 5).map((d) => (
        <div className="hist" key={d.id} style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div className="title num">{usd(d.credited || d.amount)} USDT</div>
            <div className="sub">{d.network_name} · {when(d.created_at)}</div>
            {d.status === "pending" && d.auto && <button className="btn sec sm" style={{ marginTop: 6 }} disabled={busy === d.id} onClick={() => recheck(d.id)}><Icon name="refresh" size={13} /> Check status</button>}
            {d.status === "rejected" && d.note && <div className="xs muted" style={{ marginTop: 4 }}>{d.note}</div>}
          </div>
          <span className={`pill ${stCls(d.status)}`}>{stLabel(d.status)}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Withdraw ------------------------------ */
export function WithdrawPage({ say, reload, onBack, onHistory }: { say: Say; reload: () => void; onBack: () => void; onHistory: () => void }) {
  const { m, load } = useCash(say);
  const { a: acct } = useAccount();
  const [id, setId] = useState("");
  const [addr, setAddr] = useState("");
  const [amt, setAmt] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const nets = m?.payout.networks || [];
  const net = nets.find((n) => n.id === id) || nets[0];
  const n = Number(amt) || 0;
  const bal = m?.balances.usdt || 0;
  const receive = net && n > net.fee ? Math.round((n - net.fee) * 1e6) / 1e6 : 0;
  const minAmt = net ? Math.max(net.min, net.fee) : 0;
  const valid = !!net && n >= minAmt && n <= bal && addr.trim().length >= 10;

  const submit = async () => {
    if (!net) return;
    setBusy(true);
    setOkMsg("");
    try {
      const r: any = await api("usdt-withdraw", { network: net.id, address: addr, amount: n, pin });
      setOkMsg(`Request sent. You'll receive ${usd(r.receive)} USDT after review.`);
      say("Withdrawal requested", true);
      setAmt(""); setPin(""); load(); reload();
    } catch (e: any) {
      let t = errText(e);
      if (e.message === "below_min_usdt" && e.data?.min) t = `Minimum withdrawal is ${usd(e.data.min)} USDT.`;
      say(t);
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title="Withdraw" onBack={onBack} right={<button className="btn sec sm" onClick={onHistory}><Icon name="clock" size={14} /> History</button>} />
      {!m && <div className="card empty">Loading…</div>}
      {m && (!m.payout.enabled || !nets.length) && <div className="card empty">USDT withdrawals aren&apos;t available right now.</div>}
      {m && m.payout.enabled && net && (
        <>
          <div className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Logo kind="usdt" size={40} />
            <div style={{ flex: 1 }}>
              <div className="sub" style={{ marginTop: 0 }}>Available to withdraw</div>
              <div className="title num" style={{ fontSize: 22 }}>{usd(bal)} <span className="muted" style={{ fontSize: 13 }}>USDT</span></div>
            </div>
          </div>
          <div className="card">
            <div className="title" style={{ marginBottom: 4 }}>Network</div>
            <div className="chips">
              {nets.map((x) => <button key={x.id} className={`chip ${x.id === net.id ? "on" : ""}`} onClick={() => setId(x.id)}>{x.name}</button>)}
            </div>
            <label>Wallet address</label>
            <AddrPicker acc={acct} onPick={setAddr} />
            <input placeholder={`Your USDT address on ${net.name}`} value={addr} maxLength={100} onChange={(e) => setAddr(e.target.value)} />
            <label>Amount (USDT)</label>
            <div style={{ position: "relative" }}>
              <input inputMode="decimal" placeholder={`Minimum ${usd(minAmt)}`} value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} />
              <button className="btn sec sm" style={{ position: "absolute", right: 6, top: 6 }} onClick={() => setAmt(String(Math.floor(bal * 100) / 100))}>Max</button>
            </div>
            <div className="quick">{[25, 50, 75, 100].map((p) => <button key={p} onClick={() => setAmt(String(Math.floor(bal * p) / 100))}>{p}%</button>)}</div>
            <PinField acc={acct} value={pin} onChange={setPin} />
            <div className="card" style={{ background: "var(--soft)", boxShadow: "none", marginTop: 14, marginBottom: 0 }}>
              <div className="sumrow"><span className="muted">Amount</span><b className="num">{usd(n)} USDT</b></div>
              <div className="sumrow"><span className="muted">Network fee</span><b className="num">{usd(net.fee)} USDT</b></div>
              <div className="sumrow"><span className="muted">You receive</span><b className="num" style={{ color: "#15803d" }}>{usd(receive)} USDT</b></div>
            </div>
            {n > bal && <div className="banner err"><Icon name="alert" size={18} /><span>Amount is more than your balance.</span></div>}
            <div style={{ marginTop: 14 }}><button className="btn block" disabled={busy || !valid} onClick={submit}>Request withdrawal</button></div>
            {okMsg && <div className="banner success"><Icon name="check" size={18} /><span>{okMsg}</span></div>}
            <Steps items={["Enter the address and amount, then confirm.", "We review the request and send it manually.", "You get a notification when it&apos;s paid — track it in History."]} />
            <div className="banner warn"><Icon name="alert" size={18} /><span>Double-check the address and network. Transfers can&apos;t be reversed.</span></div>
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------ History pages ------------------------------ */
export function DepositHistory({ say, onBack }: { say: Say; onBack: () => void }) {
  const { m, load } = useCash(say);
  return (
    <>
      <PageHead title="Deposit history" onBack={onBack} />
      {!m && <div className="card empty">Loading…</div>}
      {m && m.deposits.length === 0 && <div className="card empty">No deposits yet.</div>}
      {m && m.deposits.length > 0 && <div className="card">{m.deposits.map((d) => (
        <div className="hist" key={d.id} style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div className="title num">{usd(d.credited || d.amount)} USDT</div>
            <div className="sub">{d.network_name} · {when(d.created_at)}</div>
            {d.note && <div className="xs muted">{d.note}</div>}
          </div>
          <span className={`pill ${stCls(d.status)}`}>{stLabel(d.status)}</span>
        </div>
      ))}</div>}
      <button className="btn sec block" onClick={load}><Icon name="refresh" size={14} /> Refresh</button>
    </>
  );
}

export interface LegacyW { id: string; amount: number; method: string; status: string; created_at: number }
/** USDT + TFUEL (পুরনো পদ্ধতি) দুই ধরনের payout একসাথে */
export function PayoutHistory({ say, onBack, legacy, cpt, fmtTf }: { say: Say; onBack: () => void; legacy: LegacyW[]; cpt: number; fmtTf: (n: number, c: number) => string }) {
  const { m, load } = useCash(say);
  const [f, setF] = useState<"all" | "usdt" | "tfuel">("all");
  const rows = useMemo(() => {
    const u = (m?.payouts || []).map((p) => ({ key: "u" + p.id, kind: "usdt" as const, t: p.created_at, title: `${usd(p.amount)} USDT`, sub: `${p.network_name}${p.address ? " · " + short(p.address) : ""}`, extra: p.status === "paid" || p.status === "pending" ? `You receive ${usd(p.receive)} USDT` : "", status: p.status, note: p.note }));
    const l = legacy.map((w) => ({ key: "l" + w.id, kind: "tfuel" as const, t: w.created_at, title: `${fmtTf(w.amount, cpt)} TFUEL`, sub: w.method, extra: "", status: w.status, note: "" }));
    return [...u, ...l].filter((r) => f === "all" || r.kind === f).sort((a, b) => b.t - a.t);
  }, [m, legacy, f, cpt, fmtTf]);
  return (
    <>
      <PageHead title="Payout history" onBack={onBack} />
      <div className="chips" style={{ marginBottom: 10 }}>
        {(["all", "usdt", "tfuel"] as const).map((k) => <button key={k} className={`chip ${f === k ? "on" : ""}`} onClick={() => setF(k)}>{k === "all" ? "All" : k === "usdt" ? "USDT" : "TFUEL"}</button>)}
      </div>
      {!m && <div className="card empty">Loading…</div>}
      {m && rows.length === 0 && <div className="card empty">No payout requests yet.</div>}
      {rows.length > 0 && <div className="card">{rows.map((r) => (
        <div className="hist" key={r.key} style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div className="title num">{r.title}</div>
            <div className="sub">{r.sub} · {when(r.t)}</div>
            {r.extra && <div className="xs muted">{r.extra}</div>}
            {r.status === "rejected" && r.note && <div className="xs muted">Reason: {r.note}</div>}
          </div>
          <span className={`pill ${stCls(r.status)}`}>{stLabel(r.status)}</span>
        </div>
      ))}</div>}
      <button className="btn sec block" onClick={load}><Icon name="refresh" size={14} /> Refresh</button>
    </>
  );
}
