import { useCallback, useEffect, useRef, useState } from "react";
import { api, errText, fmtTf, fmtUsd, openLink, openTgLink, tg } from "@/lib/client";
import { BRAND } from "@/lib/brand";
import Logo from "@/components/Logo";
import Icon from "@/components/Icons";
import Market from "@/components/Market";
import { BoostTab, DailyCard } from "@/components/Growth";

interface Me {
  banned?: boolean;
  maintenance?: boolean;
  message?: string;
  user: { id: string; name?: string; balance: number; energy: number; maxEnergy: number; regen: number; perTap: number };
  tasks: Task[];
  sites: Site[];
  run: { site_id: string; step_done: number; total: number; status: string } | null;
  withdrawals: { id: string; amount: number; method: string; status: string; created_at: number }[];
  announcement: { text: string; kind: "info" | "warn" | "success" } | null;
  price?: number | null;
  cfg: { minWithdraw: number; methods: string[]; coinsPerUnit: number; unitLabel: string; withdrawEnabled: boolean; coinsPerTfuel: number };
}
interface Task {
  id: string;
  type: "telegram_join" | "timer_visit";
  title: string;
  url?: string;
  reward: number;
  min_wait_seconds?: number;
  done: boolean;
}
interface Site {
  id: string;
  name: string;
  reward: number;
  cooldown_minutes: number;
  total: number;
  ready_at: number;
  in_progress: boolean;
}
type Say = (t: string, ok?: boolean) => void;
type Tab = "tap" | "tasks" | "boost" | "tfuel" | "profile";

const MAX_TAPS_PER_FLUSH = 14; // server limit is 15/sec
const fmt = (n: number) => Math.floor(n).toLocaleString("en-US");
const mins = (ms: number) => {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>("tap");
  const [toast, setToast] = useState<{ t: string; ok: boolean } | null>(null);
  const [floats, setFloats] = useState<{ id: number; x: number }[]>([]);
  const [noTg, setNoTg] = useState(false);

  const balance = useRef(0);
  const energy = useRef(0);
  const pending = useRef(0);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const say = useCallback<Say>((t, ok = false) => {
    setToast({ t, ok });
    setTimeout(() => setToast(null), 2800);
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api<Me>("me");
      setMe(d);
      if (d.user) {
        balance.current = d.user.balance + pending.current;
        energy.current = Math.max(0, d.user.energy - pending.current);
      }
      rerender();
    } catch (e: any) {
      say(errText(e));
    }
  }, [say]);

  useEffect(() => {
    const w = tg();
    if (!w?.initData) {
      setNoTg(true);
      return;
    }
    w.ready();
    w.expand();
    try {
      w.setHeaderColor?.("#f4f6fb");
      w.setBackgroundColor?.("#f4f6fb");
    } catch {}
    load();
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  // every second: flush queued taps + show energy refill
  useEffect(() => {
    const iv = setInterval(async () => {
      if (me?.user && energy.current < me.user.maxEnergy) {
        energy.current = Math.min(me.user.maxEnergy, energy.current + me.user.regen);
        rerender();
      }
      const n = pending.current;
      if (n > 0) {
        pending.current = 0;
        try {
          const r = await api<{ balance: number; energy: number }>("tap", { tapCount: n });
          balance.current = r.balance + pending.current;
          energy.current = Math.max(0, r.energy - pending.current);
          rerender();
        } catch (e: any) {
          say(errText(e));
          pending.current = 0;
          load();
        }
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [me, load, say]);

  const onTap = (e: React.PointerEvent) => {
    if (!me?.user || energy.current < 1 || pending.current >= MAX_TAPS_PER_FLUSH) return;
    pending.current += 1;
    energy.current -= 1;
    balance.current += me.user.perTap;
    tg()?.HapticFeedback?.impactOccurred("light");
    const id = Date.now() + Math.random();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setFloats((f) => [...f.slice(-8), { id, x: e.clientX - rect.left }]);
    setTimeout(() => setFloats((f) => f.filter((p) => p.id !== id)), 800);
    rerender();
  };

  const go = (t: Tab) => {
    setTab(t);
    if (t !== "tap") load();
  };

  if (noTg)
    return (
      <div className="splash">
        <Logo size={72} />
        <div>Please open this app from Telegram.</div>
      </div>
    );
  if (!me)
    return (
      <div className="splash">
        <Logo size={84} className="spin" />
        <div>Loading…</div>
      </div>
    );
  if (me.banned)
    return (
      <div className="splash">
        <Logo size={64} />
        <div className="title" style={{ color: "var(--text)" }}>Account suspended</div>
        <div className="small" style={{ maxWidth: 280, textAlign: "center" }}>
          Your account has been suspended. If you think this is a mistake, please contact support.
        </div>
      </div>
    );
  if (me.maintenance)
    return (
      <div className="splash">
        <Logo size={64} />
        <div className="title" style={{ color: "var(--text)" }}>Under maintenance</div>
        <div className="small" style={{ maxWidth: 280, textAlign: "center" }}>{me.message}</div>
      </div>
    );

  const pct = Math.max(0, Math.min(100, (energy.current / me.user.maxEnergy) * 100));
  const bal = Math.floor(balance.current);
  const cpt = me.cfg.coinsPerTfuel || 1000;
  const T = (n: number) => fmtTf(n, cpt);

  const items: [Tab, string, string][] = [
    ["tap", "Tap", "tap"],
    ["tasks", "Tasks", "tasks"],
    ["boost", "Boost", "zap"],
    ["tfuel", "TFUEL", "trend"],
    ["profile", "Profile", "user"],
  ];

  return (
    <div className="app">
      {toast && <div className={`toast ${toast.ok ? "ok" : "err"}`}>{toast.t}</div>}

      <div className="topbar">
        <div className="brand">
          <Logo size={34} />
          {BRAND}
        </div>
        <div className="avatar">{(me.user.name || "U").slice(0, 1).toUpperCase()}</div>
      </div>

      {me.announcement && (
        <div className={`banner ${me.announcement.kind}`}>
          <Icon name="megaphone" size={18} />
          <span>{me.announcement.text}</span>
        </div>
      )}

      <div className="balance-card">
        <div className="lbl">Total balance</div>
        <div className="amt num">
          <Logo size={34} />
          {T(bal)}
          <span className="unit">TFUEL</span>
        </div>
        <div className="eq num">≈ {fmtUsd((bal / cpt) * (me.price || 0))} USDT</div>
      </div>

      {tab === "tap" && (
        <>
          <div className="coin-wrap">
            <button className="coin" onPointerDown={onTap} disabled={energy.current < 1} aria-label="Tap to earn">
              <Logo size={170} style={{ pointerEvents: "none" }} />
            </button>
            {floats.map((f) => (
              <span key={f.id} className="float" style={{ left: f.x, top: 70 }}>
                +{T(me.user.perTap)}
              </span>
            ))}
          </div>
          <div className="card energy">
            <div className="t">
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="bolt" size={16} /> Energy
              </span>
              <span className="num">
                {Math.max(0, Math.floor(energy.current))} / {me.user.maxEnergy}
              </span>
            </div>
            <div className="bar">
              <div style={{ width: `${pct}%` }} />
            </div>
          </div>
        </>
      )}

      {tab === "boost" && <BoostTab cpt={cpt} price={me.price || 0} say={say} reload={load} />}
      {tab === "tfuel" && <Market say={say} reload={load} cpt={cpt} />}
      {tab === "tasks" && <Tasks me={me} cpt={cpt} say={say} reload={load} />}
      {tab === "profile" && <Profile me={me} cpt={cpt} balance={bal} go={go} say={say} reload={load} />}

      <div className="nav">
        <div className="nav-in">
          {items.map(([k, label, icon]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => go(k)}>
              <Icon name={icon} size={22} />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Tasks: article site cards on top, then join / timer tasks */
function Tasks({ me, cpt, say, reload }: { me: Me; cpt: number; say: Say; reload: () => void }) {
  const T = (n: number) => fmtTf(n, cpt);
  const [busy, setBusy] = useState<string | null>(null);
  const [started, setStarted] = useState<Record<string, number>>({});
  const [now, setNow] = useState(Date.now());
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e: any) {
      say(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const startSite = (s: Site) =>
    run(s.id, async () => {
      try {
        const r = await api<{ url: string; total: number; resumed: boolean }>("start-chain", { siteId: s.id });
        say(r.resumed ? "Continuing where you left off" : `Opening article 1 of ${r.total}`, true);
        openLink(r.url);
        reload();
      } catch (e: any) {
        if (e.message === "cooldown") reload();
        throw e;
      }
    });

  const claim = async () => {
    setBusy("claim");
    try {
      const r = await api<{ reward: number }>("claim-reward", { inputCode: code });
      setCode("");
      setMsg({ t: `You earned +${T(r.reward)} TFUEL!`, ok: true });
      say(`+${T(r.reward)} TFUEL`, true);
      reload();
    } catch (e: any) {
      let t = errText(e);
      if (e.message === "wrong_code" && e.data?.attempts_left !== undefined) t += ` (${e.data.attempts_left} tries left)`;
      setMsg({ t, ok: false });
      if (e.message === "locked") reload();
    } finally {
      setBusy(null);
    }
  };

  const openTask = (t: Task) =>
    run(t.id, async () => {
      if (t.type === "timer_visit") {
        await api("start-task", { taskId: t.id });
        setStarted((s) => ({ ...s, [t.id]: Date.now() }));
      }
      if (t.url) (t.type === "telegram_join" ? openTgLink : openLink)(t.url);
    });

  const verify = (t: Task) =>
    run(t.id, async () => {
      const r = await api<{ reward: number }>("verify-telegram", { taskId: t.id });
      say(`+${T(r.reward)} TFUEL`, true);
      reload();
    });

  const finish = (t: Task) =>
    run(t.id, async () => {
      const r = await api<{ reward: number }>("complete-task", { taskId: t.id });
      say(`+${T(r.reward)} TFUEL`, true);
      reload();
    });

  const r = me.run;
  const runSite = r ? me.sites.find((s) => s.id === r.site_id) : null;

  return (
    <>
      <DailyCard cpt={cpt} say={say} reload={reload} />

      <div className="section">
        <h2>Article sites</h2>
        <span className="pill info">{me.sites.filter((s) => s.ready_at <= now).length} available</span>
      </div>

      {r && (
        <div className="card" style={{ borderColor: "#f5d58a" }}>
          <div className="row">
            <div className="title">Enter your code</div>
            <span className="pill warn">
              {r.step_done}/{r.total} read
            </span>
          </div>
          <div className="sub">
            {r.status === "code_issued"
              ? `You reached the last article${runSite ? ` of ${runSite.name}` : ""}. Enter the 6-digit code shown there.`
              : "Read every article in order, tap “Next article” each time. The code appears on the last one."}
          </div>
          <div className="code-row">
            <input
              inputMode="numeric"
              maxLength={6}
              placeholder="······"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <button className="btn" disabled={code.length !== 6 || busy === "claim"} onClick={claim}>
              Claim
            </button>
          </div>
          {msg && <div className={`banner ${msg.ok ? "success" : "err"}`}>{msg.t}</div>}
        </div>
      )}

      {me.sites.length === 0 && <div className="card empty">No article sites yet. Check back soon.</div>}
      {me.sites.map((s) => {
        const wait = s.ready_at - now;
        const ready = wait <= 0;
        return (
          <div className="card" key={s.id}>
            <div className="row">
              <div className="left">
                <div className="ico">
                  <Icon name="article" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="title">{s.name}</div>
                  <div className="sub">
                    {s.total} articles · <span className="reward">+{T(s.reward)}</span>
                  </div>
                </div>
              </div>
              {s.in_progress ? (
                <button className="btn sm" disabled={busy === s.id} onClick={() => startSite(s)}>
                  Continue
                </button>
              ) : ready ? (
                <button className="btn sm" disabled={busy === s.id} onClick={() => startSite(s)}>
                  Start
                </button>
              ) : (
                <span className="pill">
                  <Icon name="clock" size={13} /> {mins(wait)}
                </span>
              )}
            </div>
            {s.in_progress && r && (
              <div className="progress">
                <div style={{ width: `${(r.step_done / r.total) * 100}%` }} />
              </div>
            )}
          </div>
        );
      })}

      <div className="section">
        <h2>Quick tasks</h2>
      </div>
      {me.tasks.length === 0 && <div className="card empty">No tasks right now.</div>}
      {me.tasks.map((t) => {
        const st = started[t.id];
        const wait = (t.min_wait_seconds || 10) * 1000;
        const left = st ? Math.max(0, Math.ceil((st + wait - now) / 1000)) : 0;
        return (
          <div className="card" key={t.id}>
            <div className="row">
              <div className="left">
                <div className={`ico ${t.type === "telegram_join" ? "blue" : ""}`}>
                  <Icon name={t.type === "telegram_join" ? "send" : "clock"} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="title">{t.title}</div>
                  <div className="sub">
                    <span className="reward">+{T(t.reward)}</span>
                  </div>
                </div>
              </div>
              {t.done ? (
                <span className="pill ok">
                  <Icon name="check" size={13} /> Done
                </span>
              ) : t.type === "telegram_join" ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn sec sm" disabled={busy === t.id} onClick={() => openTask(t)}>
                    Join
                  </button>
                  <button className="btn sm" disabled={busy === t.id} onClick={() => verify(t)}>
                    Verify
                  </button>
                </div>
              ) : !st ? (
                <button className="btn sm" disabled={busy === t.id} onClick={() => openTask(t)}>
                  Open
                </button>
              ) : (
                <button className="btn sm" disabled={left > 0 || busy === t.id} onClick={() => finish(t)}>
                  {left > 0 ? `${left}s` : "Claim"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Profile: balance in TFUEL + USDT value, shortcuts, optional legacy payout methods, history */
function Profile({ me, cpt, balance, go, say, reload }: { me: Me; cpt: number; balance: number; go: (t: Tab) => void; say: Say; reload: () => void }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const { minWithdraw, methods, withdrawEnabled } = me.cfg;
  const T = (n: number) => fmtTf(n, cpt);

  const submit = async () => {
    setBusy(true);
    try {
      await api("withdraw", { amount: Math.round((Number(amount) || 0) * cpt), method, account });
      setMsg({ t: "Request sent. We'll review it and pay out soon.", ok: true });
      setAmount("");
      reload();
    } catch (e: any) {
      let t = errText(e);
      if (e.message === "below_minimum" && e.data?.min) t = `Minimum withdrawal is ${T(e.data.min)} TFUEL.`;
      setMsg({ t, ok: false });
    } finally {
      setBusy(false);
    }
  };

  const stCls = (s: string) => (s === "paid" ? "ok" : s === "rejected" ? "err" : "warn");

  return (
    <>
      <div className="section">
        <h2>{me.user.name || "Profile"}</h2>
        <span className="pill">ID {me.user.id}</span>
      </div>

      <div className="card">
        <div className="row">
          <div className="left">
            <div className="ico green"><Icon name="wallet" /></div>
            <div>
              <div className="title num">{T(balance)} TFUEL</div>
              <div className="sub num">≈ {fmtUsd((balance / cpt) * (me.price || 0))} USDT</div>
            </div>
          </div>
        </div>
        <div className="grid2" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => go("tfuel")}>Sell / Withdraw</button>
          <button className="btn sec" onClick={() => go("boost")}>Boost &amp; Stake</button>
        </div>
        <div className="xs muted" style={{ marginTop: 8 }}>Sell TFUEL for USDT and withdraw to your wallet from the TFUEL tab.</div>
      </div>

      {methods.length > 0 && (
        <div className="card">
          <div className="title">Other payout methods</div>
          <div className="sub">Minimum {T(minWithdraw)} TFUEL</div>
          {!withdrawEnabled ? (
            <div className="banner warn">
              <Icon name="alert" size={18} />
              <span>Withdrawals are paused for now. Please check back later.</span>
            </div>
          ) : (
            <>
              <label>Amount (TFUEL)</label>
              <input inputMode="decimal" placeholder={`Min ${T(minWithdraw)}`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
              <div className="small muted" style={{ marginTop: 4 }}>
                {Number(amount) > 0 ? `≈ ${fmtUsd(Number(amount) * (me.price || 0))} USDT` : `Available: ${T(balance)} TFUEL`}
              </div>
              <label>Method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">Select a method</option>
                {methods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <label>Account / wallet address</label>
              <input placeholder="Enter your account or address" maxLength={100} value={account} onChange={(e) => setAccount(e.target.value)} />
              <div style={{ marginTop: 14 }}>
                <button className="btn block" disabled={busy} onClick={submit}>
                  Request withdrawal
                </button>
              </div>
              {msg && <div className={`banner ${msg.ok ? "success" : "err"}`}>{msg.t}</div>}
            </>
          )}
        </div>
      )}

      {me.withdrawals.length > 0 && (
        <div className="card">
          <div className="title" style={{ marginBottom: 4 }}>Payout history</div>
          {me.withdrawals.map((w) => (
            <div className="hist" key={w.id}>
              <div>
                <div className="title num">{T(w.amount)} TFUEL</div>
                <div className="sub">
                  {w.method} · {new Date(w.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </div>
              </div>
              <span className={`pill ${stCls(w.status)}`}>{w.status[0].toUpperCase() + w.status.slice(1)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
