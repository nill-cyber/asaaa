import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import Icon from "@/components/Icons";

const ago = (t: number) => {
  const m = Math.max(1, Math.floor((Date.now() - t) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

/** 🔔 বেল + বার্তার তালিকা */
export function Bell({ unread, onRead }: { unread: number; onRead: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ id: string; m: string; at: number }[] | null>(null);
  useEffect(() => {
    if (!open) return;
    setItems(null);
    api<any>("inbox", { action: "read" }).then((d) => { setItems(d.items); onRead(); }).catch(() => setItems([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <>
      <button className="bell" aria-label="Notifications" onClick={() => setOpen(true)}>
        <Icon name="bell" size={20} />
        {unread > 0 && <span className="badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="sheet-bg" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ marginBottom: 8 }}>
              <div className="title" style={{ fontSize: 17 }}>Notifications</div>
              <button className="btn ghost sm" onClick={() => setOpen(false)} aria-label="Close"><Icon name="x" size={18} /></button>
            </div>
            {items === null && <div className="small muted">Loading…</div>}
            {items && items.length === 0 && <div className="empty">No notifications yet.<div className="xs">Deposits, payouts, stakes and alerts show up here.</div></div>}
            {items?.map((n) => (
              <div className="hist" key={n.id} style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>{n.m}</div>
                <div className="xs muted" style={{ marginLeft: 10, whiteSpace: "nowrap" }}>{ago(n.at)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const SLIDES = [
  { icon: "tap", t: "Tap to earn", d: "Tap the coin to earn TFUEL. Each tap uses energy — when it runs out it refills fully after a while." },
  { icon: "tasks", t: "Read & complete tasks", d: "Finish article sites and tasks for bigger rewards. Read the top, scroll to the end, and enter your code." },
  { icon: "trend", t: "Trade & withdraw", d: "Buy or sell TFUEL at the live price, deposit USDT and request withdrawals from the TFUEL tab or your Profile." },
] as const;

/** নতুন user-এর ৩ ধাপের পরিচিতি */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;
  const finish = () => { api("onboard", {}).catch(() => {}); onDone(); };
  const s = SLIDES[i];
  return (
    <div className="sheet-bg" style={{ alignItems: "center" }}>
      <div className="sheet" style={{ borderRadius: 22, margin: 16, textAlign: "center", paddingBottom: 20 }}>
        <div className="ico gold" style={{ margin: "6px auto 12px", width: 56, height: 56 }}><Icon name={s.icon} size={28} /></div>
        <div className="title" style={{ fontSize: 20 }}>{s.t}</div>
        <div className="sub" style={{ margin: "8px 0 16px" }}>{s.d}</div>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 16 }}>
          {SLIDES.map((_, k) => <span key={k} style={{ width: k === i ? 18 : 7, height: 7, borderRadius: 4, background: k === i ? "var(--brand)" : "var(--line)", transition: "width .2s" }} />)}
        </div>
        <button className="btn block" onClick={() => (last ? finish() : setI(i + 1))}>{last ? "Get started" : "Next"}</button>
        {!last && <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={finish}>Skip</button>}
      </div>
    </div>
  );
}
