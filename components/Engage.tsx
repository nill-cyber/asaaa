import { useCallback, useEffect, useRef, useState } from "react";
import { api, errText, fmtTf } from "@/lib/client";
import Icon from "@/components/Icons";

type Say = (t: string, ok?: boolean) => void;
export interface Engage {
  spin: { enabled: boolean; prizes: number[]; free: number; extra: number };
  ads: { enabled: boolean; blockId: string; coins: number; coinsLeft: number; energyLeft: number; spinLeft: number };
  notify: { available: boolean; on: boolean };
}

export function useEngage() {
  const [e, setE] = useState<Engage | null>(null);
  const load = useCallback(async () => {
    try {
      setE(await api<Engage>("engage"));
    } catch {}
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { e, load };
}

/** Rewarded ad (Adsgram). server: ad-start → (ad) → ad-claim */
export function useAd(blockId: string, say: Say) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!blockId || typeof document === "undefined" || (window as any).Adsgram || document.getElementById("adsgram-sdk")) return;
    const s = document.createElement("script");
    s.id = "adsgram-sdk";
    s.src = "https://sad.adsgram.ai/js/sad.min.js";
    s.async = true;
    document.head.appendChild(s);
  }, [blockId]);
  const watch = async (purpose: "coins" | "energy" | "spin"): Promise<any | null> => {
    if (busy) return null;
    setBusy(true);
    try {
      const { nonce } = await api<{ nonce: string }>("ad-start", { purpose });
      const A = (window as any).Adsgram;
      if (!A) {
        say("Ads aren't ready yet. Please try again in a moment.");
        return null;
      }
      let res: any;
      try {
        res = await A.init({ blockId }).show();
      } catch {
        say("No ad available right now, or it was skipped.");
        return null;
      }
      if (!res?.done) {
        say("Watch the whole ad to get the reward.");
        return null;
      }
      return await api<any>("ad-claim", { nonce });
    } catch (e: any) {
      say(errText(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { watch, busy };
}

const COLORS = ["#fff4d6", "#ffe3a3", "#fff4d6", "#ffd978", "#fff4d6", "#ffcc57", "#fff4d6", "#ffbf3a", "#fff4d6", "#ffb31f", "#fff4d6", "#ffa60a"];

/** Lucky Spin wheel */
export function SpinCard({ cpt, say, reload }: { cpt: number; say: Say; reload: () => void }) {
  const { e, load } = useEngage();
  const [rot, setRot] = useState(0);
  const [busy, setBusy] = useState(false);
  const ad = useAd(e?.ads.enabled ? e.ads.blockId : "", say);
  const spinning = useRef(false);
  if (!e || !e.spin.enabled) return null;
  const P = e.spin.prizes;
  const N = P.length;
  const seg = 360 / N;
  const have = e.spin.free + e.spin.extra;

  const spin = async () => {
    if (busy || spinning.current) return;
    setBusy(true);
    spinning.current = true;
    try {
      const r = await api<any>("spin");
      setRot((cur) => (Math.floor(cur / 360) + 6) * 360 - (r.index * seg + seg / 2));
      setTimeout(() => {
        say(`You won +${fmtTf(r.coins, cpt)} TFUEL!`, true);
        spinning.current = false;
        setBusy(false);
        load();
        reload();
      }, 4200);
    } catch (er: any) {
      say(errText(er));
      spinning.current = false;
      setBusy(false);
    }
  };
  const watch = async () => {
    const r = await ad.watch("spin");
    if (r) {
      say("Extra spin unlocked!", true);
      load();
    }
  };

  const R = 100;
  const pt = (a: number) => [R + R * Math.sin((a * Math.PI) / 180), R - R * Math.cos((a * Math.PI) / 180)];
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <div className="row" style={{ textAlign: "left" }}>
        <div className="left">
          <div className="ico gold"><Icon name="gift" /></div>
          <div>
            <div className="title">Lucky Spin</div>
            <div className="sub">{have > 0 ? `${have} spin${have > 1 ? "s" : ""} available` : "Come back tomorrow for a free spin"}</div>
          </div>
        </div>
      </div>
      <div style={{ position: "relative", width: 220, margin: "14px auto 8px" }}>
        <div style={{ position: "absolute", left: "50%", top: -6, transform: "translateX(-50%)", zIndex: 2, width: 0, height: 0, borderLeft: "9px solid transparent", borderRight: "9px solid transparent", borderTop: "16px solid #0f172a" }} />
        <svg viewBox="0 0 200 200" width="220" height="220" style={{ transform: `rotate(${rot}deg)`, transition: busy ? "transform 4s cubic-bezier(.12,.7,.1,1)" : "none", filter: "drop-shadow(0 6px 14px rgba(245,158,11,.3))" }}>
          <circle cx="100" cy="100" r="99" fill="#fff" stroke="#f59e0b" strokeWidth="2" />
          {P.map((c, i) => {
            const [x1, y1] = pt(i * seg);
            const [x2, y2] = pt((i + 1) * seg);
            const mid = i * seg + seg / 2;
            const [tx, ty] = [100 + 66 * Math.sin((mid * Math.PI) / 180), 100 - 66 * Math.cos((mid * Math.PI) / 180)];
            return (
              <g key={i}>
                <path d={`M100,100 L${x1},${y1} A${R},${R} 0 0 1 ${x2},${y2} Z`} fill={COLORS[i % COLORS.length]} stroke="#fff" strokeWidth="1" />
                <text x={tx} y={ty} fontSize="11" fontWeight="800" fill="#7a4a00" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${mid} ${tx} ${ty})`}>{fmtTf(c, cpt)}</text>
              </g>
            );
          })}
          <circle cx="100" cy="100" r="14" fill="#fff" stroke="#f59e0b" strokeWidth="2" />
        </svg>
      </div>
      <button className="btn block" disabled={busy || have < 1} onClick={spin}>{busy ? "Spinning…" : have > 0 ? "Spin" : "No spins left"}</button>
      {e.ads.enabled && e.ads.spinLeft > 0 && (
        <button className="btn sec block" style={{ marginTop: 8 }} disabled={busy || ad.busy} onClick={watch}>
          Watch an ad for an extra spin ({e.ads.spinLeft} left today)
        </button>
      )}
    </div>
  );
}

/** Promo code */
export function PromoCard({ cpt, say, reload }: { cpt: number; say: Say; reload: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api<any>("promo", { code });
      say(`Code accepted: +${fmtTf(r.coins, cpt)} TFUEL`, true);
      setCode("");
      reload();
    } catch (e: any) {
      say(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="title">Promo code</div>
      <div className="sub">Have a code from our channel? Enter it for a bonus.</div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input placeholder="ENTER CODE" maxLength={24} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} />
        <button className="btn" disabled={busy || code.length < 3} onClick={go}>Redeem</button>
      </div>
    </div>
  );
}

/** Watch-an-ad bonus (coins). Shown on the Tasks tab */
export function AdBonus({ cpt, say, reload }: { cpt: number; say: Say; reload: () => void }) {
  const { e, load } = useEngage();
  const ad = useAd(e?.ads.enabled ? e.ads.blockId : "", say);
  if (!e || !e.ads.enabled || e.ads.coins <= 0) return null;
  const go = async () => {
    const r = await ad.watch("coins");
    if (r) {
      say(`+${fmtTf(r.coins, cpt)} TFUEL`, true);
      load();
      reload();
    }
  };
  return (
    <div className="card">
      <div className="row">
        <div className="left">
          <div className="ico gold"><Icon name="zap" /></div>
          <div>
            <div className="title">Watch &amp; earn</div>
            <div className="sub">+{fmtTf(e.ads.coins, cpt)} TFUEL per ad · {e.ads.coinsLeft} left today</div>
          </div>
        </div>
        <button className="btn sm" disabled={ad.busy || e.ads.coinsLeft < 1} onClick={go}>{e.ads.coinsLeft < 1 ? "Done" : "Watch"}</button>
      </div>
    </div>
  );
}

/** Shown on the Tap screen when energy is empty */
export function AdRefill({ say, reload }: { say: Say; reload: () => void }) {
  const { e, load } = useEngage();
  const ad = useAd(e?.ads.enabled ? e.ads.blockId : "", say);
  if (!e || !e.ads.enabled || e.ads.energyLeft < 1) return null;
  const go = async () => {
    const r = await ad.watch("energy");
    if (r) {
      say("Energy refilled!", true);
      load();
      reload();
    }
  };
  return (
    <button className="btn block" style={{ marginTop: 10 }} disabled={ad.busy} onClick={go}>
      <Icon name="bolt" size={16} /> Watch an ad to refill energy ({e.ads.energyLeft} left today)
    </button>
  );
}

/** Leaderboard */
interface LB {
  enabled: boolean;
  board: "d" | "w" | "all";
  list: { rank: number; name: string; v: number; me: boolean }[];
  me: { v: number; rank: number | null };
  prizes: number[];
  endsAt: number | null;
}
const medal = (r: number) => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : String(r));
const lft = (t: number) => {
  const ms = Math.max(0, t - Date.now());
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export function Leaderboard({ cpt, say }: { cpt: number; say: Say }) {
  const [board, setBoard] = useState<"d" | "w" | "all">("w");
  const [d, setD] = useState<LB | null>(null);
  useEffect(() => {
    setD(null);
    api<LB>("leaderboard", { board }).then(setD).catch((e) => say(errText(e)));
  }, [board, say]);
  return (
    <>
      <div className="seg">
        {([["d", "Today"], ["w", "This week"], ["all", "All time"]] as const).map(([k, l]) => (
          <button key={k} className={board === k ? "on" : ""} onClick={() => setBoard(k)}>{l}</button>
        ))}
      </div>
      {!d ? (
        <div className="empty">Loading…</div>
      ) : !d.enabled ? (
        <div className="empty">The leaderboard is paused.</div>
      ) : (
        <>
          {board === "w" && d.prizes.length > 0 && (
            <div className="banner info">
              <Icon name="gift" size={18} />
              <span>
                Weekly prizes for the top {d.prizes.length}: {d.prizes.slice(0, 3).map((p, i) => `#${i + 1} ${fmtTf(p, cpt)}`).join(" · ")}
                {d.prizes.length > 3 ? " …" : ""} TFUEL. {d.endsAt ? `Ends in ${lft(d.endsAt)}.` : ""}
              </span>
            </div>
          )}
          <div className="card">
            <div className="row" style={{ marginBottom: 6 }}>
              <span className="title">Your rank</span>
              <b className="num">{d.me.rank ? `#${d.me.rank}` : "50+"} · {fmtTf(d.me.v, cpt)} TFUEL</b>
            </div>
            {d.list.length === 0 && <div className="small muted">No one yet — be the first!</div>}
            {d.list.map((r) => (
              <div className="hist" key={r.rank} style={r.me ? { background: "var(--soft)", borderRadius: 10, padding: "8px 8px" } : undefined}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 28, textAlign: "center", fontWeight: 800 }}>{medal(r.rank)}</span>
                  <span className="title" style={{ fontSize: 14 }}>{r.name}{r.me ? " (you)" : ""}</span>
                </div>
                <span className="num" style={{ fontWeight: 700 }}>
                  {fmtTf(r.v, cpt)}
                  {board === "w" && d.prizes[r.rank - 1] ? <span className="muted xs"> · 🎁 {fmtTf(d.prizes[r.rank - 1], cpt)}</span> : null}
                </span>
              </div>
            ))}
          </div>
          <div className="xs muted" style={{ textAlign: "center" }}>Ranked by TFUEL earned from tapping, tasks, rewards and mining.</div>
        </>
      )}
    </>
  );
}
