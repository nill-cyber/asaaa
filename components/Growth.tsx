import { useCallback, useEffect, useState } from "react";
import { api, errText, fmtTf, fmtUsd, openTgLink, tg } from "@/lib/client";
import Icon from "@/components/Icons";

type Say = (t: string, ok?: boolean) => void;
interface G {
  boosts: { plans: { id: string; name: string; price: number; tap: number; en: number; regen: number; mph: number; days: number; active: boolean; expires_at: number }[]; mining: { pending: number; perHour: number; capHours: number } };
  staking: { plans: { id: string; name: string; days: number; pct: number; min: number; max: number; left: number | null }[]; stakes: { id: string; name: string; amount: number; reward: number; end: number; status: string; ready: boolean }[] };
  daily: { enabled: boolean; claimedToday: boolean; streak: number; rewards: number[]; nextIndex: number };
  referral: { enabled: boolean; link: string; referrerBonus: number; inviteeBonus: number; count: number; earned: number; pending: boolean; list: { id: string; name: string; at: number; bonus: number }[] };
}
const left = (t: number) => {
  const ms = Math.max(0, t - Date.now());
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

function useGrowth(say: Say) {
  const [g, setG] = useState<G | null>(null);
  const load = useCallback(async () => {
    try {
      setG(await api<G>("growth"));
    } catch (e: any) {
      say(errText(e));
    }
  }, [say]);
  useEffect(() => {
    load();
  }, [load]);
  return { g, load };
}

/** Daily reward with a 7-day streak strip */
export function DailyCard({ cpt, say, reload }: { cpt: number; say: Say; reload: () => void }) {
  const { g, load } = useGrowth(say);
  const [busy, setBusy] = useState(false);
  if (!g || !g.daily.enabled) return null;
  const d = g.daily;
  const claim = async () => {
    setBusy(true);
    try {
      const r = await api<any>("claim-daily");
      say(`+${fmtTf(r.reward, cpt)} TFUEL · Day ${r.streak}`, true);
      load();
      reload();
    } catch (e: any) {
      say(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const shown = d.rewards.slice(0, 7);
  const cur = d.claimedToday ? (d.streak - 1) % d.rewards.length : d.nextIndex;
  return (
    <div className="card">
      <div className="row">
        <div className="left">
          <div className="ico gold"><Icon name="gift" /></div>
          <div>
            <div className="title">Daily reward</div>
            <div className="sub">{d.claimedToday ? `Streak: ${d.streak} day${d.streak > 1 ? "s" : ""} · come back tomorrow` : d.streak > 0 ? `Keep your ${d.streak}-day streak going` : "Claim every day to build a streak"}</div>
          </div>
        </div>
        <button className="btn sm" disabled={busy || d.claimedToday} onClick={claim}>{d.claimedToday ? "Claimed" : "Claim"}</button>
      </div>
      <div className="days">
        {shown.map((r, i) => (
          <div key={i} className={`day ${i < cur || (i === cur && d.claimedToday) ? "done" : i === cur ? "now" : ""}`}>
            <div className="xs">Day {i + 1}</div>
            <div className="b num" style={{ fontSize: 12 }}>{fmtTf(r, cpt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BoostTab({ cpt, price, say, reload }: { cpt: number; price: number; say: Say; reload: () => void }) {
  const { g, load } = useGrowth(say);
  const [sub, setSub] = useState<"boost" | "stake" | "friends">("boost");
  const [, tick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(iv);
  }, []);
  if (!g) return <div className="empty">Loading…</div>;
  const done = () => {
    load();
    reload();
  };
  return (
    <>
      <div className="seg">
        {(["boost", "stake", "friends"] as const).map((k) => (
          <button key={k} className={sub === k ? "on" : ""} onClick={() => setSub(k)}>{k === "boost" ? "Boosts" : k === "stake" ? "Stake" : "Friends"}</button>
        ))}
      </div>
      {sub === "boost" && <Boosts g={g} cpt={cpt} say={say} done={done} />}
      {sub === "stake" && <Stake g={g} cpt={cpt} price={price} say={say} done={done} />}
      {sub === "friends" && <Friends g={g} cpt={cpt} say={say} />}
    </>
  );
}

function Boosts({ g, cpt, say, done }: { g: G; cpt: number; say: Say; done: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const m = g.boosts.mining;
  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      say(await fn(), true);
      done();
    } catch (e: any) {
      say(errText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {m.perHour > 0 && (
        <div className="card" style={{ borderColor: "#f6e3b4", background: "linear-gradient(135deg,#fff,#fff8e6)" }}>
          <div className="row">
            <div className="left">
              <div className="ico gold"><Icon name="bolt" /></div>
              <div>
                <div className="title">Auto-mining</div>
                <div className="sub">+{fmtTf(m.perHour, cpt)} TFUEL / hour · stores up to {m.capHours}h</div>
              </div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <div><div className="xs muted">Ready to collect</div><div className="big num" style={{ fontSize: 22 }}>{fmtTf(m.pending, cpt)}</div></div>
            <button className="btn" disabled={busy === "mine" || m.pending < 1} onClick={() => act("mine", async () => { const r = await api<any>("collect-mining"); return `+${fmtTf(r.amount, cpt)} TFUEL collected`; })}>Collect</button>
          </div>
        </div>
      )}
      {g.boosts.plans.length === 0 && <div className="card empty">No boosts available yet.</div>}
      {g.boosts.plans.map((p) => (
        <div className="card" key={p.id}>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div className="left" style={{ alignItems: "flex-start" }}>
              <div className="ico blue"><Icon name="zap" /></div>
              <div>
                <div className="title">{p.name}</div>
                <div className="chips">
                  {p.tap > 0 && <span className="tag info">+{fmtTf(p.tap, cpt)} / tap</span>}
                  {p.en > 0 && <span className="tag info">+{p.en} energy</span>}
                  {p.regen > 0 && <span className="tag info">+{p.regen}/s refill</span>}
                  {p.mph > 0 && <span className="tag info">+{fmtTf(p.mph, cpt)} / hr</span>}
                  <span className="tag">{p.days > 0 ? `${p.days} days` : "Permanent"}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <span className="reward">{fmtTf(p.price, cpt)} TFUEL</span>
            {p.active ? (
              <span className="pill ok"><Icon name="check" size={13} /> Active{p.expires_at ? ` · ${left(p.expires_at)}` : ""}</span>
            ) : (
              <button className="btn sm" disabled={busy === p.id} onClick={() => act(p.id, async () => { await api("buy-boost", { planId: p.id }); return `${p.name} activated`; })}>Buy boost</button>
            )}
          </div>
        </div>
      ))}
      <div className="xs muted" style={{ textAlign: "center" }}>Boosts are bought with your in-app TFUEL balance.</div>
    </>
  );
}

function Stake({ g, cpt, price, say, done }: { g: G; cpt: number; price: number; say: Say; done: () => void }) {
  const [sel, setSel] = useState<string>("");
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const plan = g.staking.plans.find((p) => p.id === sel) || g.staking.plans[0];
  const coins = Math.floor((Number(amt) || 0) * cpt);
  const reward = plan ? Math.floor((coins * plan.pct) / 100) : 0;
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      say(await fn(), true);
      done();
    } catch (e: any) {
      say(errText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {g.staking.plans.length === 0 ? (
        <div className="card empty">No staking plans right now.</div>
      ) : (
        <div className="card">
          <div className="title" style={{ marginBottom: 8 }}>Lock TFUEL, earn a fixed reward</div>
          {g.staking.plans.map((p) => (
            <button key={p.id} className={`opt ${plan?.id === p.id ? "on" : ""}`} onClick={() => setSel(p.id)}>
              <div>
                <div className="title" style={{ textAlign: "left" }}>{p.name} · {p.days} days</div>
                <div className="sub" style={{ textAlign: "left" }}>{fmtTf(p.min, cpt)}–{fmtTf(p.max, cpt)} TFUEL{p.left !== null ? ` · ${fmtTf(p.left, cpt)} left` : ""}</div>
              </div>
              <span className="pill ok">+{p.pct}%</span>
            </button>
          ))}
          {plan && (
            <>
              <label>Amount to stake (TFUEL)</label>
              <input inputMode="decimal" placeholder={`${fmtTf(plan.min, cpt)} – ${fmtTf(plan.max, cpt)}`} value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} />
              {coins > 0 && (
                <div className="card" style={{ background: "var(--soft)", boxShadow: "none", border: 0, margin: "12px 0 0" }}>
                  <div className="row sm"><span className="muted">After {plan.days} days you get</span><b className="num">{fmtTf(coins + reward, cpt)} TFUEL</b></div>
                  <div className="row sm" style={{ marginTop: 6 }}><span className="muted">Reward</span><span className="num ok-t">+{fmtTf(reward, cpt)} ({fmtUsd((reward / cpt) * price)})</span></div>
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <button className="btn block" disabled={busy === "stake" || coins < plan.min || coins > plan.max} onClick={() => run("stake", async () => { await api("stake", { planId: plan.id, amount: coins }); setAmt(""); return "Staked successfully"; })}>Stake</button>
              </div>
              <div className="xs muted" style={{ marginTop: 8 }}>Staked TFUEL is locked until the plan ends.</div>
            </>
          )}
        </div>
      )}
      {g.staking.stakes.length > 0 && (
        <div className="card">
          <div className="title" style={{ marginBottom: 4 }}>Your stakes</div>
          {g.staking.stakes.map((k) => (
            <div className="hist" key={k.id}>
              <div>
                <div className="title num">{fmtTf(k.amount, cpt)} → {fmtTf(k.amount + k.reward, cpt)}</div>
                <div className="sub">{k.name} · {k.status === "claimed" ? "Completed" : k.ready ? "Matured" : `${left(k.end)} left`}</div>
              </div>
              {k.status === "claimed" ? <span className="pill ok">Paid</span> : k.ready ? <button className="btn sm" disabled={busy === k.id} onClick={() => run(k.id, async () => { const r = await api<any>("claim-stake", { id: k.id }); return `+${fmtTf(r.paid, cpt)} TFUEL`; })}>Claim</button> : <span className="pill warn"><Icon name="lock" size={12} /> Locked</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Friends({ g, cpt, say }: { g: G; cpt: number; say: Say }) {
  const r = g.referral;
  if (!r.enabled) return <div className="card empty">Referrals are paused right now.</div>;
  const share = () => {
    const text = "Earn TFUEL by tapping and reading — join me!";
    const url = `https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent(text)}`;
    if (tg()?.openTelegramLink) openTelegramShare(url);
    else window.open(url, "_blank");
  };
  return (
    <>
      <div className="card">
        <div className="left" style={{ marginBottom: 10 }}>
          <div className="ico green"><Icon name="users" /></div>
          <div>
            <div className="title">Invite friends</div>
            <div className="sub">You get +{fmtTf(r.referrerBonus, cpt)} TFUEL, your friend gets +{fmtTf(r.inviteeBonus, cpt)} — once they finish their first task.</div>
          </div>
        </div>
        {r.link ? (
          <>
            <div className="gap" style={{ background: "var(--soft)", borderRadius: 12, padding: "10px 12px" }}>
              <span className="xs" style={{ wordBreak: "break-all", flex: 1, userSelect: "text", fontWeight: 600 }}>{r.link}</span>
              <button className="btn sec sm" onClick={() => { navigator.clipboard?.writeText(r.link); say("Link copied", true); }}><Icon name="copy" size={14} /></button>
            </div>
            <button className="btn block" style={{ marginTop: 12 }} onClick={share}><Icon name="send" size={16} /> Share invite</button>
          </>
        ) : (
          <div className="banner warn"><Icon name="alert" size={18} /><span>Invite link isn&apos;t ready yet. Please check back soon.</span></div>
        )}
        {r.pending && <div className="banner info"><Icon name="info" size={18} /><span>You joined through an invite. Finish your first task to unlock your welcome bonus.</span></div>}
      </div>
      <div className="grid2" style={{ marginBottom: 12 }}>
        <div className="card" style={{ marginBottom: 0 }}><div className="sub">Friends joined</div><div className="title num" style={{ fontSize: 20 }}>{r.count}</div></div>
        <div className="card" style={{ marginBottom: 0 }}><div className="sub">Earned</div><div className="title num" style={{ fontSize: 20 }}>{fmtTf(r.earned, cpt)}</div></div>
      </div>
      {r.list.length > 0 && (
        <div className="card">
          {r.list.map((f) => (
            <div className="hist" key={f.id}><span>{f.name}</span><b className="num">+{fmtTf(f.bonus, cpt)}</b></div>
          ))}
        </div>
      )}
    </>
  );
}
const openTelegramShare = (url: string) => openTgLink(url);
