import { useCallback, useEffect, useState } from "react";
import { api, errText, fmtTf, fmtUsd, openLink, openTgLink, tg } from "@/lib/client";
import Icon from "@/components/Icons";
import Logo from "@/components/Logo";
import { PageHead, Qr } from "@/components/Cashier";

type Say = (t: string, ok?: boolean) => void;
const when = (t: number) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/* ---------------- Pay a shop order (opened from the shop via ?startapp=pay_<id>) ---------------- */
interface Order {
  order: { id: string; shop: string; title: string; usd: number; status: string; exp: number; return_url: string };
  pay: { tfuel: { coins: number; balance: number } | null; usdt: { amount: number; balance: number } | null };
  pin: boolean;
  pref: "tfuel" | "usdt";
}
export function PaySheet({ id, cpt, say, onClose, reload }: { id: string; cpt: number; say: Say; onClose: () => void; reload: () => void }) {
  const [o, setO] = useState<Order | null>(null);
  const [err, setErr] = useState("");
  const [cur, setCur] = useState<"tfuel" | "usdt">("tfuel");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ url: string; amount: number; cur: string } | null>(null);
  useEffect(() => {
    api<Order>("shop-user", { action: "order", id }).then((d) => { setO(d); setCur(d.pref); }).catch((e) => setErr(errText(e)));
  }, [id]);
  const pay = async () => {
    setBusy(true);
    try {
      const r = await api<any>("shop-user", { action: "pay", id, cur, pin });
      setDone({ url: r.return_url, amount: r.amount, cur: r.cur });
      reload();
    } catch (e: any) { say(errText(e)); } finally { setBusy(false); }
  };
  const opt = (c: "tfuel" | "usdt") => {
    if (!o) return null;
    const p = c === "tfuel" ? o.pay.tfuel : o.pay.usdt;
    const need = c === "tfuel" ? (o.pay.tfuel?.coins ?? 0) : (o.pay.usdt?.amount ?? 0);
    const bal = p ? (c === "tfuel" ? (o.pay.tfuel as any).balance : (o.pay.usdt as any).balance) : 0;
    const enough = !!p && bal + 1e-9 >= need;
    return (
      <button key={c} className="mrow" disabled={!p} onClick={() => setCur(c)}
        style={{ border: `2px solid ${cur === c && p ? "var(--gold2)" : "var(--line)"}`, borderRadius: 16, marginBottom: 10, opacity: p ? 1 : 0.5 }}>
        <span className="mi">{c === "tfuel" ? <Logo size={28} /> : <Logo kind="usdt" size={28} />}</span>
        <span className="mt">
          {c === "tfuel" ? "Pay with TFUEL" : "Pay with USDT"}
          <div className="ms num">{p ? (c === "tfuel" ? `${fmtTf(need, cpt)} TFUEL` : `${fmtUsd(need)} USDT`) : "Not accepted here"}{p ? ` · you have ${c === "tfuel" ? fmtTf(bal, cpt) : fmtUsd(bal)}` : ""}</div>
          {p && !enough && <div className="ms" style={{ color: "var(--err)" }}>Not enough balance</div>}
        </span>
      </button>
    );
  };
  const can = o && o.order.status === "open" && ((cur === "tfuel" && o.pay.tfuel && o.pay.tfuel.balance >= o.pay.tfuel.coins) || (cur === "usdt" && o.pay.usdt && o.pay.usdt.balance + 1e-9 >= o.pay.usdt.amount));
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {err && <div className="banner err" style={{ marginTop: 0 }}>{err}</div>}
        {!o && !err && <div className="empty">Loading…</div>}
        {done && (
          <div style={{ textAlign: "center" }}>
            <div className="ico green" style={{ margin: "6px auto 10px" }}><Icon name="check" /></div>
            <div className="title" style={{ fontSize: 18 }}>Payment complete</div>
            <div className="sub num" style={{ marginBottom: 14 }}>{done.cur === "tfuel" ? `${fmtTf(done.amount, cpt)} TFUEL` : `${fmtUsd(done.amount)} USDT`} paid</div>
            <button className="btn block" onClick={() => { openLink(done.url); onClose(); }}>Return to shop</button>
          </div>
        )}
        {o && !done && (
          <>
            <div className="sub">{o.order.shop} is requesting</div>
            <div className="title num" style={{ fontSize: 26 }}>{fmtUsd(o.order.usd)}</div>
            <div className="sub" style={{ marginBottom: 12 }}>{o.order.title}</div>
            {o.order.status !== "open" ? (
              <div className="banner warn"><Icon name="alert" size={18} /><span>{o.order.status === "paid" ? "This order has already been paid." : o.order.status === "expired" ? "This request has expired. Go back to the shop and try again." : `This order is ${o.order.status}.`}</span></div>
            ) : (
              <>
                <div className="title" style={{ fontSize: 14, marginBottom: 8 }}>Choose how to pay</div>
                {opt("tfuel")}
                {opt("usdt")}
                {o.pin && (<><label>Withdraw PIN</label><input type="password" inputMode="numeric" maxLength={6} autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></>)}
                <div style={{ marginTop: 12 }}><button className="btn block" disabled={busy || !can || (o.pin && pin.length < 4)} onClick={pay}>{busy ? "Paying…" : "Confirm payment"}</button></div>
                <div className="xs muted" style={{ marginTop: 8, textAlign: "center" }}>TFUEL price is locked at the live rate when you confirm.</div>
              </>
            )}
            <button className="btn sec block" style={{ marginTop: 10 }} onClick={onClose}>Close</button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- Shops page ---------------- */
interface ShopRow { id: string; name: string; domain: string; tfuel: boolean; usdt: boolean; connected: boolean }
interface OrderRow { id: string; shop_name?: string; shop?: string; title?: string; usd: number; status: string; cur?: string; at?: number }
export function ShopsPage({ say, onBack, cpt }: { say: Say; onBack: () => void; cpt: number }) {
  const [d, setD] = useState<{ enabled: boolean; shops: ShopRow[]; orders: OrderRow[] } | null>(null);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => { api<any>("shop-user", { action: "list" }).then(setD).catch((e) => say(errText(e))); }, [say]);
  useEffect(() => { load(); }, [load]);
  const open = async (s: ShopRow) => {
    if (!s.connected && !confirm(`Connect ${s.name}?\n\nThe shop will receive your Telegram name and ID so you're signed in automatically. It never sees your balance or PIN.`)) return;
    setBusy(s.id);
    try {
      const r = await api<any>("shop-user", { action: "launch", shop: s.id, consent: true });
      openLink(r.url);
      load();
    } catch (e: any) { say(errText(e)); } finally { setBusy(""); }
  };
  const off = async (s: ShopRow) => {
    if (!confirm(`Disconnect ${s.name}? You can reconnect any time.`)) return;
    setBusy(s.id);
    try { await api("shop-user", { action: "disconnect", shop: s.id }); say("Disconnected", true); load(); } catch (e: any) { say(errText(e)); } finally { setBusy(""); }
  };
  return (
    <>
      <PageHead title="Partner shops" onBack={onBack} />
      {!d && <div className="card empty">Loading…</div>}
      {d && !d.enabled && <div className="card empty">Shops aren&apos;t available right now.</div>}
      {d && d.enabled && (
        <>
          <div className="banner" style={{ marginTop: 0 }}><Icon name="info" size={18} /><span>Open a partner shop and you&apos;re signed in automatically. At checkout, choose to pay with TFUEL or USDT.</span></div>
          {d.shops.length === 0 && <div className="card empty">No shops yet.</div>}
          {d.shops.map((s) => (
            <div className="card" key={s.id}>
              <div className="row">
                <div className="left">
                  <div className="ico"><Icon name="gift" /></div>
                  <div>
                    <div className="title">{s.name}</div>
                    <div className="sub">{[s.tfuel && "TFUEL", s.usdt && "USDT"].filter(Boolean).join(" · ")} · {s.connected ? "Connected" : "Not connected"}</div>
                  </div>
                </div>
              </div>
              <div className="grid2" style={{ marginTop: 10 }}>
                <button className="btn" disabled={busy === s.id} onClick={() => open(s)}>{s.connected ? "Open shop" : "Connect & open"}</button>
                {s.connected && <button className="btn sec" disabled={busy === s.id} onClick={() => off(s)}>Disconnect</button>}
              </div>
            </div>
          ))}
          <div className="mhead">Purchases</div>
          {d.orders.length === 0 && <div className="card empty">No purchases yet.</div>}
          {d.orders.length > 0 && (
            <div className="card">
              {d.orders.map((o) => (
                <div className="hist" key={o.id}>
                  <div style={{ minWidth: 0 }}>
                    <div className="title num">{fmtUsd(o.usd)}</div>
                    <div className="sub">{o.shop_name || o.title || "Shop"} · {o.at ? when(o.at) : ""}{o.cur ? ` · ${o.cur === "usdt" ? "USDT" : "TFUEL"}` : ""}</div>
                  </div>
                  <span className={`pill ${o.status === "paid" ? "ok" : o.status === "refunded" ? "warn" : "err"}`}>{o.status[0].toUpperCase() + o.status.slice(1)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ---------------- Support ---------------- */
interface Ticket { id: string; subject: string; status: string; updated_at: number }
interface Thread { id: string; subject: string; status: string; msgs: { f: string; t: string; at: number }[] }
export function SupportPage({ say, onBack }: { say: Say; onBack: () => void }) {
  const [list, setList] = useState<Ticket[] | null>(null);
  const [th, setTh] = useState<Thread | null>(null);
  const [sub, setSub] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<any>("support", { action: "list" }).then((d) => setList(d.tickets)).catch((e) => say(errText(e))); }, [say]);
  useEffect(() => { load(); }, [load]);
  const openT = async (id: string) => { try { setTh((await api<any>("support", { action: "get", id })).ticket); } catch (e: any) { say(errText(e)); } };
  const create = async () => {
    setBusy(true);
    try { const r = await api<any>("support", { action: "create", subject: sub, message: msg }); setSub(""); setMsg(""); say("Sent. We'll reply here and in Telegram.", true); load(); openT(r.id); } catch (e: any) { say(errText(e)); } finally { setBusy(false); }
  };
  const reply = async () => {
    if (!th) return;
    setBusy(true);
    try { setTh((await api<any>("support", { action: "reply", id: th.id, message: msg })).ticket); setMsg(""); load(); } catch (e: any) { say(errText(e)); } finally { setBusy(false); }
  };
  if (th)
    return (
      <>
        <PageHead title={th.subject} onBack={() => { setTh(null); setMsg(""); load(); }} right={<span className={`pill ${th.status === "closed" ? "" : th.status === "answered" ? "ok" : "warn"}`}>{th.status}</span>} />
        <div className="card">
          {th.msgs.map((m, i) => (
            <div key={i} style={{ marginBottom: 12, textAlign: m.f === "user" ? "right" : "left" }}>
              <div style={{ display: "inline-block", maxWidth: "88%", textAlign: "left", background: m.f === "user" ? "#fff3d1" : "var(--soft)", color: m.f === "user" ? "#3a2500" : "var(--text)", borderRadius: 14, padding: "9px 12px", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 14 }}>{m.t}</div>
              <div className="xs muted" style={{ marginTop: 2 }}>{m.f === "user" ? "You" : "Support"} · {when(m.at)}</div>
            </div>
          ))}
        </div>
        {th.status !== "closed" ? (
          <div className="card">
            <textarea rows={3} maxLength={1000} placeholder="Write a reply…" value={msg} onChange={(e) => setMsg(e.target.value)} style={{ width: "100%" }} />
            <button className="btn block" style={{ marginTop: 10 }} disabled={busy || msg.trim().length < 2} onClick={reply}>Send reply</button>
          </div>
        ) : <div className="banner" style={{ marginTop: 0 }}><span>This ticket is closed. Open a new one if you still need help.</span></div>}
      </>
    );
  return (
    <>
      <PageHead title="Help & support" onBack={onBack} />
      <div className="card">
        <div className="title" style={{ marginBottom: 6 }}>New message</div>
        <input placeholder="Subject (e.g. Deposit not credited)" maxLength={80} value={sub} onChange={(e) => setSub(e.target.value)} />
        <textarea rows={4} maxLength={1000} placeholder="Describe the problem. Include amounts and transaction IDs." value={msg} onChange={(e) => setMsg(e.target.value)} style={{ width: "100%", marginTop: 8 }} />
        <button className="btn block" style={{ marginTop: 10 }} disabled={busy || sub.trim().length < 3 || msg.trim().length < 5} onClick={create}>Send to support</button>
      </div>
      <div className="mhead">Your tickets</div>
      {!list && <div className="card empty">Loading…</div>}
      {list && list.length === 0 && <div className="card empty">No tickets yet.</div>}
      {list && list.length > 0 && (
        <div className="menu">
          {list.map((t) => (
            <button className="mrow" key={t.id} onClick={() => openT(t.id)}>
              <span className="mt">{t.subject}<div className="ms">{when(t.updated_at)}</div></span>
              <span className={`pill ${t.status === "closed" ? "" : t.status === "answered" ? "ok" : "warn"}`}>{t.status}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------- Invite card (Settings → Account) ---------------- */
export function InviteCard({ say }: { say: Say }) {
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => { api<any>("growth").then((g) => setLink(g.referral?.enabled ? g.referral.link : "")).catch(() => setLink("")); }, []);
  if (!link) return link === "" ? <div className="small muted">Referral link isn&apos;t available right now.</div> : <div className="small muted">Loading…</div>;
  return (
    <div>
      <div className="title">Your referral link</div>
      <Qr text={link} size={150} />
      <div className="addrbox"><span>{link}</span><button className="btn sec sm" onClick={() => { navigator.clipboard?.writeText(link); say("Link copied", true); }}><Icon name="copy" size={14} /></button></div>
      <button className="btn sec block" style={{ marginTop: 10 }} onClick={() => openTgLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Earn TFUEL by tapping and reading — join me!")}`)}>Share on Telegram</button>
    </div>
  );
}
