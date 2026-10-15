import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, errText, fmtTf, fmtUsd, openLink, openTgLink, tg } from "@/lib/client";
import { BRAND } from "@/lib/brand";
import Logo from "@/components/Logo";
import Icon from "@/components/Icons";
import Market from "@/components/Market";
import { DepositBox, PayoutBox } from "@/components/Market";
import { Bell, Onboarding } from "@/components/Inbox";
import { SettingsPanel, useAccount, PinField, AddrPicker } from "@/components/Settings";
import { BoostTab, DailyCard } from "@/components/Growth";
import { SpinCard, PromoCard, AdBonus, AdRefill, Leaderboard, InAppAds } from "@/components/Engage";

interface Me {
  banned?: boolean;
  maintenance?: boolean;
  message?: string;
  user: { id: string; name?: string; balance: number; energy: number; energyCost: number; refillAt: number | null; refillHours: number; maxEnergy: number; regen: number; perTap: number };
  tasks: Task[];
  sites: Site[];
  run: { site_id: string; step_done: number; total: number; status: string } | null;
  withdrawals: { id: string; amount: number; method: string; status: string; created_at: number }[];
  announcement: { text: string; kind: "info" | "warn" | "success" } | null;
  price?: number | null;
  unread?: number;
  showIntro?: boolean;
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

const hm = (ms: number) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const x = sec % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${x}s` : `${x}s`;
};

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>("tap");
  const [toast, setToast] = useState<{ t: string; ok: boolean } | null>(null);
  const [floats, setFloats] = useState<{ id: number; x: number }[]>([]);
  const [noTg, setNoTg] = useState(false);

  const balance = useRef(0);
  const energy = useRef(0);
  const refillAt = useRef<number | null>(null);
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
        energy.current = Math.max(0, d.user.energy - pending.current * d.user.energyCost);
        refillAt.current = d.user.refillAt;
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
      if (me?.user) {
        const cost = me.user.energyCost;
        if (me.user.regen > 0 && energy.current < me.user.maxEnergy) {
          energy.current = Math.min(me.user.maxEnergy, energy.current + me.user.regen);
        }
        // empty → waits until the refill time, then reloads (server refills to full)
        if (energy.current < cost && refillAt.current && Date.now() >= refillAt.current) {
          refillAt.current = null;
          load();
        }
        rerender();
      }
      const n = pending.current;
      if (n > 0) {
        pending.current = 0;
        try {
          const r = await api<{ balance: number; energy: number; refillAt: number | null }>("tap", { tapCount: n });
          balance.current = r.balance + pending.current;
          energy.current = Math.max(0, r.energy - pending.current * me!.user.energyCost);
          refillAt.current = r.refillAt ?? null;
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
    if (!me?.user || energy.current + 1e-9 < me.user.energyCost || pending.current >= MAX_TAPS_PER_FLUSH) return;
    pending.current += 1;
    energy.current -= me.user.energyCost;
    balance.current += me.user.perTap;
    tg()?.HapticFeedback?.impactOccurred("light");
    const id = Date.now() + Math.random();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setFloats((f) => [...f.slice(-8), { id, x: e.clientX - rect.left }]);
    setTimeout(() => setFloats((f) => f.filter((p) => p.id !== id)), 800);
    rerender();
  };

  const [mkSub, setMkSub] = useState<string | undefined>(undefined);
  const go = (t: Tab, sub?: string) => {
    setMkSub(t === "tfuel" ? sub : undefined);
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
  const empty = energy.current + 1e-9 < me.user.energyCost;
  const left = refillAt.current ? Math.max(0, refillAt.current - Date.now()) : 0;
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
          <Logo size={28} />
          {BRAND}
        </div>
        <div className="gap">
          <Bell unread={me.unread || 0} onRead={() => setMe((m) => (m ? { ...m, unread: 0 } : m))} />
          <div className="avatar">{(me.user.name || "U").slice(0, 1).toUpperCase()}</div>
        </div>
      </div>

      {me.announcement && (
        <div className={`banner ${me.announcement.kind}`}>
          <Icon name="megaphone" size={18} />
          <span>{me.announcement.text}</span>
        </div>
      )}

      {tab !== "tfuel" && tab !== "profile" && (
      <div className="balance-card">
        <div className="lbl">Total balance</div>
        <div className="amt num">
          <Logo size={26} />
          {T(bal)}
          <span className="unit">TFUEL</span>
        </div>
        <div className="eq num">≈ {fmtUsd((bal / cpt) * (me.price || 0))} USDT</div>
      </div>
      )}

      {tab === "tap" && (
        <>
          <div className="coin-wrap">
            <button className="coin" onPointerDown={onTap} disabled={empty} aria-label="Tap to earn">
              <Logo size={140} style={{ pointerEvents: "none" }} />
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
            <div className="small" style={{ marginTop: 8, textAlign: "center" }}>
              {empty
                ? refillAt.current
                  ? `Energy empty — full refill in ${hm(left)}`
                  : "Energy empty — refilling soon…"
                : `Each tap uses ${me.user.energyCost} energy`}
            </div>
            {empty && <AdRefill say={say} reload={load} />}
          </div>
        </>
      )}

      {tab === "boost" && <BoostTab cpt={cpt} price={me.price || 0} say={say} reload={load} />}
      {tab === "tfuel" && <Market key={mkSub || "m"} startSub={mkSub} say={say} reload={load} cpt={cpt} />}
      {tab === "tasks" && <TasksWrap me={me} cpt={cpt} say={say} reload={load} />}
      {tab === "profile" && <Profile me={me} cpt={cpt} balance={bal} go={go} say={say} reload={load} />}

      <InAppAds />
      {me.showIntro && <Onboarding onDone={() => setMe((m) => (m ? { ...m, showIntro: false } : m))} />}
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

function TasksWrap({ me, cpt, say, reload }: { me: Me; cpt: number; say: Say; reload: () => void }) {
  const [view, setView] = useState<"earn" | "top">("earn");
  return (
    <>
      <div className="seg">
        <button className={view === "earn" ? "on" : ""} onClick={() => setView("earn")}>Earn</button>
        <button className={view === "top" ? "on" : ""} onClick={() => setView("top")}>Leaderboard</button>
      </div>
      {view === "earn" ? (
        <>
          <Tasks me={me} cpt={cpt} say={say} reload={reload} />
          <PromoCard cpt={cpt} say={say} reload={reload} />
        </>
      ) : (
        <Leaderboard cpt={cpt} say={say} />
      )}
    </>
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
      <SpinCard cpt={cpt} say={say} reload={reload} />
      <AdBonus cpt={cpt} say={say} reload={reload} />

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
function Profile({ me, cpt, balance, go, say, reload }: { me: Me; cpt: number; balance: number; go: (t: Tab, sub?: string) => void; say: Say; reload: () => void }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState("");
  const { a: acct } = useAccount();
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const { minWithdraw, methods, withdrawEnabled } = me.cfg;
  const T = (n: number) => fmtTf(n, cpt);

  const submit = async () => {
    setBusy(true);
    try {
      await api("withdraw", { amount: Math.round((Number(amount) || 0) * cpt), method, account, pin });
      setPin("");
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

      <WalletView balance={balance} cpt={cpt} go={go} say={say} reload={reload}>
        {methods.length > 0 && (
          <Acc icon="send" title="Other payout methods">
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
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <label>Account / wallet address</label>
                <AddrPicker acc={acct} onPick={setAccount} />
                <input placeholder="Enter your account or address" maxLength={100} value={account} onChange={(e) => setAccount(e.target.value)} />
                <PinField acc={acct} value={pin} onChange={setPin} />
                <div style={{ marginTop: 14 }}>
                  <button className="btn block" disabled={busy} onClick={submit}>Request withdrawal</button>
                </div>
                {msg && <div className={`banner ${msg.ok ? "success" : "err"}`}>{msg.t}</div>}
              </>
            )}
          </Acc>
        )}
        <Acc icon="settings" title="Settings">
          <SettingsPanel say={say} />
        </Acc>
        <Acc icon="wallet" title="Payout History">
          {me.withdrawals.length === 0 && <div className="small muted">No payout requests yet.</div>}
          {me.withdrawals.map((w) => (
            <div className="hist" key={w.id}>
              <div>
                <div className="title num">{T(w.amount)} TFUEL</div>
                <div className="sub">{w.method} · {new Date(w.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
              </div>
              <span className={`pill ${stCls(w.status)}`}>{w.status[0].toUpperCase() + w.status.slice(1)}</span>
            </div>
          ))}
          <button className="btn sec block" style={{ marginTop: 10 }} onClick={() => go("tfuel", "history")}>USDT deposits &amp; payouts</button>
        </Acc>
      </WalletView>
    </>
  );
}

/** Collapsible profile section */
function Acc({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`acc ${open ? "open" : ""}`}>
      <button className="acc-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="acc-i"><Icon name={icon as any} size={20} /></span>
        <span className="acc-t">{title}</span>
        <span className="acc-c"><Icon name="chevron" size={18} /></span>
      </button>
      {open && <div className="acc-b">{children}</div>}
    </div>
  );
}

const EARN_LABEL: Record<string, string> = {
  tap: "Tapping", articles: "Article sites", tasks: "Tasks", daily: "Daily rewards", referral: "Referrals",
  mining: "Auto-mining", staking: "Staking rewards", bought: "Bought with USDT", adjust: "Admin credit",
};
const SPEND_LABEL: Record<string, string> = { boosts: "Boosts", sold: "Sold for USDT", withdrawn: "Withdrawn" };
const USDT_LABEL: Record<string, string> = {
  deposited: "Deposited", sold: "From selling TFUEL", bought: "Spent buying TFUEL", withdrawn: "Withdrawn", adjusted: "Admin adjustment",
};
const ACT_LABEL: Record<string, string> = {
  article: "Article reward", task: "Task reward", daily: "Daily reward", referral: "Referral bonus", mining: "Mining collected",
  stake_paid: "Staking payout", boost: "Boost purchased", sell: "Sold TFUEL", buy: "Bought TFUEL", deposit: "USDT deposit",
  deposit_rejected: "Deposit rejected", usdt_withdraw: "USDT withdrawal", usdt_paid: "Withdrawal paid", usdt_rejected: "Withdrawal refunded", adjust: "Balance adjustment",
  spin: "Lucky Spin", promo: "Promo code", prize: "Leaderboard prize", ads: "Ad reward", limit_buy: "Limit buy filled", limit_sell: "Limit sell filled",
};

interface Wallet {
  price: number | null;
  tfuel: { balance: number; locked: number; mining: number; earn: Record<string, number>; spent: Record<string, number> };
  usdt: { balance: number; tot: Record<string, number> };
  activity: { id: string; t: string; c: number; u: number; n: string; at: number }[];
  portfolio: [number, number][];
}

/** Exchanger-style wallet: both balances, where they came from, recent activity */
function WalletView({ balance, cpt, go, say, reload, children }: { balance: number; cpt: number; go: (t: Tab, sub?: string) => void; say: Say; reload: () => void; children?: React.ReactNode }) {
  const [panel, setPanel] = useState<null | "deposit" | "withdraw">(null);
  const [w, setW] = useState<Wallet | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    api<Wallet>("wallet").then(setW).catch(() => setErr(true));
  }, []);
  const T = (n: number) => fmtTf(n, cpt);
  if (!w) return <div className="card small muted" style={{ textAlign: "center" }}>{err ? "Couldn't load wallet." : "Loading wallet…"}</div>;

  const price = w.price || 0;
  const tf = Math.max(balance, 0);
  const tfUsd = (tf / cpt) * price;
  const total = tfUsd + w.usdt.balance;
  const earnRows = Object.entries(w.tfuel.earn).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const earnSum = earnRows.reduce((a, [, v]) => a + v, 0) || 1;
  const spentRows = Object.entries(w.tfuel.spent).filter(([, v]) => v > 0);
  const usdtRows = Object.entries(w.usdt.tot).filter(([, v]) => v !== 0);

  const topEarn = earnRows.slice(0, 3);
  const usdtPos = usdtRows.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const usdtSum = usdtPos.reduce((a, [, v]) => a + v, 0) || 1;

  return (
    <>
      <div className="balance-card" style={{ marginTop: 0 }}>
        <div className="lbl">Total balance</div>
        <div className="amt num"><Logo size={32} />{T(tf)}<span className="unit">TFUEL</span></div>
        <div className="eq num">≈ {fmtUsd(tfUsd)} USDT{w.usdt.balance > 0 ? ` · + ${fmtUsd(w.usdt.balance)} USDT cash` : ""}</div>
      </div>

      <div className="grid3b">
        <button className={`btn ${panel === "deposit" ? "" : "sec"}`} onClick={() => setPanel(panel === "deposit" ? null : "deposit")}>Deposit</button>
        <button className={`btn ${panel === "withdraw" ? "" : "sec"}`} onClick={() => setPanel(panel === "withdraw" ? null : "withdraw")}>Withdraw</button>
        <button className="btn sec" onClick={() => go("tfuel", "trade")}>Trade</button>
      </div>

      {panel === "deposit" && <DepositBox say={say} reload={reload} />}
      {panel === "withdraw" && <PayoutBox say={say} reload={reload} />}

      <div className="grid2" style={{ alignItems: "stretch" }}>
        <div className="balance-card" style={{ marginBottom: 0 }}>
          <div className="lbl">Total wallet value</div>
          <div className="amt num" style={{ fontSize: 26, flexWrap: "wrap", gap: 4 }}>{fmtUsd(total)}</div>
          <div className="eq">USDT</div>
        </div>
        <div className="card" style={{ marginBottom: 0, padding: 14 }}>
          <div className="title" style={{ fontSize: 13, marginBottom: 6 }}>How you got your TFUEL</div>
          {topEarn.length === 0 && <div className="xs muted">Start tapping!</div>}
          {topEarn.map(([k, v]) => (
            <div key={k} style={{ marginBottom: 6 }}>
              <div className="xs" style={{ display: "flex", justifyContent: "space-between" }}><span>{EARN_LABEL[k] || k}</span><span className="muted">{Math.round((v / earnSum) * 100)}%</span></div>
              <div className="bar" style={{ height: 6 }}><div style={{ width: `${(v / earnSum) * 100}%` }} /></div>
            </div>
          ))}
          <div className="title" style={{ fontSize: 13, margin: "8px 0 6px" }}>USDT</div>
          {usdtPos.length === 0 && <div className="xs muted">No USDT yet</div>}
          {usdtPos.map(([k, v]) => (
            <div key={k} style={{ marginBottom: 6 }}>
              <div className="xs" style={{ display: "flex", justifyContent: "space-between" }}><span>{USDT_LABEL[k] || k}</span><span className="muted">{Math.round((v / usdtSum) * 100)}%</span></div>
              <div className="bar" style={{ height: 6 }}><div style={{ width: `${(v / usdtSum) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ height: 12 }} />

      <Acc icon="wallet" title="Portfolio & Assets">
        <Portfolio pts={w.portfolio || []} total={total} />
        <div className="title" style={{ margin: "8px 0 4px" }}>My assets</div>
        <div className="row hist">
          <div className="left">
            <Logo size={34} />
            <div>
              <div className="title">TFUEL</div>
              <div className="sub num">{price ? `@ ${fmtUsd(price)} USDT` : "price unavailable"}</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="title num">{T(tf)}</div>
            <div className="sub num">≈ {fmtUsd(tfUsd)} USDT</div>
          </div>
        </div>
        <div className="row hist">
          <div className="left">
            <Logo kind="usdt" size={34} />
            <div>
              <div className="title">USDT</div>
              <div className="sub">Tether</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="title num">{fmtUsd(w.usdt.balance)}</div>
            <div className="sub num">1 USDT = $1.00</div>
          </div>
        </div>
        {(w.tfuel.locked > 0 || w.tfuel.mining > 0) && (
          <div className="small muted num" style={{ marginTop: 8 }}>
            {w.tfuel.locked > 0 && <>Staked (locked): {T(w.tfuel.locked)} TFUEL · </>}
            {w.tfuel.mining > 0 && <>Mining waiting: {T(w.tfuel.mining)} TFUEL</>}
          </div>
        )}
        <div className="title" style={{ margin: "14px 0 8px" }}>All TFUEL sources</div>
        {earnRows.length === 0 && <div className="small muted">Nothing yet — start tapping!</div>}
        {earnRows.map(([k, v]) => (
          <div key={k} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              <span>{EARN_LABEL[k] || k}</span>
              <span className="num">{T(v)} <span className="muted">· {Math.round((v / earnSum) * 100)}%</span></span>
            </div>
            <div className="bar"><div style={{ width: `${(v / earnSum) * 100}%` }} /></div>
          </div>
        ))}
        {spentRows.length > 0 && (
          <div className="small muted" style={{ marginTop: 6 }}>
            Used: {spentRows.map(([k, v]) => `${SPEND_LABEL[k] || k} ${T(v)}`).join(" · ")}
          </div>
        )}
        <div className="title" style={{ margin: "14px 0 4px" }}>USDT history</div>
        {usdtRows.length === 0 && <div className="small muted">No USDT activity yet. Deposit USDT or sell some TFUEL.</div>}
        {usdtRows.map(([k, v]) => (
          <div className="hist" key={k}>
            <div className="title" style={{ fontSize: 14 }}>{USDT_LABEL[k] || k}</div>
            <div className="num" style={{ fontWeight: 700 }}>{v < 0 ? "−" : ""}{fmtUsd(Math.abs(v))} USDT</div>
          </div>
        ))}
        <div className="grid2" style={{ marginTop: 12 }}>
          <button className="btn sec" onClick={() => go("boost")}>Boost &amp; Stake</button>
          <button className="btn sec" onClick={() => go("tfuel", "orders")}>Orders &amp; alerts</button>
        </div>
      </Acc>

      <Acc icon="clock" title="Transaction History">
        <ActivityList first={w.activity} cpt={cpt} />
      </Acc>

      <Acc icon="send" title="Telegram Notifications">
        <NotifyToggle />
      </Acc>

      {children}
    </>
  );
}

/** Portfolio value over time (USDT) */
function Portfolio({ pts, total }: { pts: [number, number][]; total: number }) {
  const gid = "pf" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const data = pts.length ? [...pts.slice(0, -1), [Date.now(), total] as [number, number]] : [];
  if (data.length < 2) {
    return (
      <div className="card">
        <div className="title">Portfolio</div>
        <div className="small muted" style={{ marginTop: 4 }}>Your wallet value chart builds up as you come back. Check again later.</div>
      </div>
    );
  }
  const W = 320, H = 110;
  const ys = data.map((d) => d[1]);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = (hi - lo) * 0.15 || hi * 0.05 || 0.01;
  lo -= pad; hi += pad;
  const t0 = data[0][0], t1 = data[data.length - 1][0] || t0 + 1;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => (1 - (v - lo) / (hi - lo)) * (H - 6) + 3;
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(d[0]).toFixed(1)},${y(d[1]).toFixed(1)}`).join(" ");
  const first = data[0][1];
  const pct = first > 0 ? (total / first - 1) * 100 : 0;
  const col = pct >= 0 ? "#16a34a" : "#e5484d";
  return (
    <div className="card">
      <div className="row">
        <div className="title">Portfolio</div>
        <span className={`pill ${pct >= 0 ? "ok" : "err"}`}>{pct >= 0 ? "+" : ""}{pct.toFixed(1)}%</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", marginTop: 6 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={col} stopOpacity=".22" />
            <stop offset="1" stopColor={col} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="row xs muted" style={{ marginTop: 2 }}>
        <span>{new Date(t0).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
        <span>Now · {fmtUsd(total)}</span>
      </div>
    </div>
  );
}

type ActItem = { id: string; t: string; c: number; u: number; n: string; at: number };
const FILTERS: [string, string, string[] | null][] = [
  ["all", "All", null],
  ["tfuel", "TFUEL", ["article", "task", "daily", "referral", "mining", "stake_paid", "boost", "spin", "promo", "prize", "ads", "adjust"]],
  ["trade", "Trades", ["buy", "sell", "limit_buy", "limit_sell"]],
  ["usdt", "USDT", ["deposit", "deposit_rejected", "usdt_withdraw", "usdt_paid", "usdt_rejected", "buy", "sell", "limit_buy", "limit_sell"]],
];

/** Recent activity with "load more" and filters */
function ActivityList({ first, cpt }: { first: ActItem[]; cpt: number }) {
  const [items, setItems] = useState<ActItem[]>(first);
  const [more, setMore] = useState(first.length >= 30);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState("all");
  const T = (n: number) => fmtTf(n, cpt);
  const load = async () => {
    setBusy(true);
    try {
      const r = await api<{ items: ActItem[]; more: boolean }>("history", { before: items[items.length - 1]?.id });
      setItems((cur) => [...cur, ...r.items]);
      setMore(r.more);
    } catch {} finally {
      setBusy(false);
    }
  };
  const allow = FILTERS.find((x) => x[0] === f)?.[2];
  const shown = allow ? items.filter((a) => allow.includes(a.t)) : items;
  if (!items.length) return <div className="small muted">No transactions yet.</div>;
  return (
    <div>
      <div className="seg" style={{ margin: "0 0 4px" }}>
        {FILTERS.map(([k, l]) => (
          <button key={k} className={f === k ? "on" : ""} style={{ padding: "6px 4px" }} onClick={() => setF(k)}>{l}</button>
        ))}
      </div>
      {shown.length === 0 && <div className="small muted" style={{ padding: "8px 0" }}>Nothing here yet.</div>}
      {shown.map((a) => (
        <div className="hist" key={a.id}>
          <div>
            <div className="title" style={{ fontSize: 14 }}>{ACT_LABEL[a.t] || a.t}</div>
            <div className="sub">
              {a.n ? `${a.n} · ` : ""}
              {new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
          <div style={{ textAlign: "right" }} className="num">
            {a.c !== 0 && <div style={{ fontWeight: 700 }}>{a.c > 0 ? "+" : "−"}{T(Math.abs(a.c))} TFUEL</div>}
            {a.u !== 0 && <div style={{ fontWeight: 700 }}>{a.u > 0 ? "+" : "−"}{fmtUsd(Math.abs(a.u))} USDT</div>}
          </div>
        </div>
      ))}
      {more && (
        <button className="btn sec block" style={{ marginTop: 10 }} disabled={busy} onClick={load}>{busy ? "Loading…" : "Load more"}</button>
      )}
    </div>
  );
}

/** Telegram bot messages on/off */
function NotifyToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    api<any>("engage").then((d) => setOn(d.notify.available ? d.notify.on : null)).catch(() => {});
  }, []);
  if (on === null) return <div className="small muted">Open the bot in Telegram and press Start to turn notifications on.</div>;
  const flip = async () => {
    const next = !on;
    setOn(next);
    try {
      await api("notify-pref", { on: next });
    } catch {
      setOn(!next);
    }
  };
  return (
    <div>
      <div className="row">
        <div>
          <div className="title">Telegram notifications</div>
          <div className="sub">Energy full, deposits, payouts, stakes and price alerts. Make sure you've started the bot.</div>
        </div>
        <button className={`switch ${on ? "on" : ""}`} onClick={flip} aria-label="Toggle notifications" style={{ flexShrink: 0 }} />
      </div>
    </div>
  );
}
