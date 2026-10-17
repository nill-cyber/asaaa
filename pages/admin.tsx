import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { api, tg } from "@/lib/client";
import { BRAND } from "@/lib/brand";
import Logo from "@/components/Logo";
import Icon, { IconName } from "@/components/Icons";
import { ShopsPage, SupportPage } from "@/components/AdminShops";
import EngagePage from "@/components/AdminEngage";

type Tab = "shops" | "support" | "rewards" | "dashboard" | "users" | "sites" | "tasks" | "withdrawals" | "usdt" | "market" | "fraud" | "settings" | "channel" | "logs" | "engage";
const NAV: [Tab, string, IconName][] = [
  ["dashboard", "Dashboard", "grid"],
  ["users", "Users", "users"],
  ["sites", "Article Sites", "article"],
  ["tasks", "Tasks", "tasks"],
  ["withdrawals", "Withdrawals", "wallet"],
  ["rewards", "Rewards & Plans", "gift"],
  ["usdt", "USDT desk", "download"],
  ["market", "Market & Trading", "trend"],
  ["shops", "Shops", "gift"],
  ["support", "Support", "megaphone"],
  ["engage", "Engagement", "zap"],
  ["fraud", "Fraud monitor", "shield"],
  ["settings", "Settings", "settings"],
  ["channel", "Channel check", "send"],
  ["logs", "Activity log", "activity"],
];

const CptCtx = createContext(1000);
/** coin → TFUEL (admin inputs are in coins; this shows the TFUEL equivalent) */
const useTf = () => {
  const cpt = useContext(CptCtx);
  return (n: any) => {
    const d = Math.min(6, Math.max(0, Math.round(Math.log10(Math.max(1, cpt)))));
    return ((Number(n) || 0) / cpt).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
};
const Hint = ({ coins }: { coins: any }) => {
  const tf = useTf();
  return <div className="xs muted" style={{ marginTop: 3 }}>= {tf(coins)} TFUEL</div>;
};

const fmt = (n: number) => Math.floor(Number(n) || 0).toLocaleString("en-US");
const when = (t?: number) => (t ? new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const em = (e: any) => String(e?.message || "Something went wrong");

type Call = <T = any>(body: Record<string, any>, okMsg?: string) => Promise<T | null>;

export default function Admin() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<{ t: string; ok: boolean } | null>(null);
  const [pending, setPending] = useState(0);
  const [pendingU, setPendingU] = useState(0);
  const [pendingP, setPendingP] = useState(0);
  const [cpt, setCpt] = useState(1000);

  const say = useCallback((t: string, ok = false) => {
    setToast({ t, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const call: Call = useCallback(
    async (body, okMsg) => {
      try {
        const d = await api("admin", body);
        if (okMsg) say(okMsg, true);
        return d as any;
      } catch (e: any) {
        if (/Forbidden|Missing auth|Bad signature|expired/i.test(em(e)) && body.action === "stats") setAuthed(false);
        say(em(e));
        return null;
      }
    },
    [say]
  );

  useEffect(() => {
    (async () => {
      try {
        await api("admin", { action: "stats" });
        setAuthed(true);
      } catch {
        setAuthed(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!authed) return;
    api("admin", { action: "getSettings" })
      .then((d: any) => setCpt(d.settings.coins_per_tfuel || 1000))
      .catch(() => {});
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    api("admin", { action: "stats" })
      .then((d: any) => { setPending(d.pending?.count || 0); setPendingU((d.usdt?.pendingDeposits?.count || 0)); setPendingP(d.usdt?.pendingPayouts?.count || 0); })
      .catch(() => {});
  }, [authed, tab]);

  const logout = () => {
    try {
      sessionStorage.removeItem("adm");
    } catch {}
    setAuthed(false);
  };

  if (authed === null)
    return (
      <div className="splash">
        <Logo size={64} className="spin" />
      </div>
    );
  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  return (
    <>
      <Head>
        <title>{BRAND} · Admin</title>
      </Head>
      {toast && <div className={`toast ${toast.ok ? "ok" : "err"}`}>{toast.t}</div>}
      <CptCtx.Provider value={cpt}>
      <div className="adm">
        <div className="mtop">
          <div className="brand">
            <Logo size={28} /> Admin
          </div>
          <button className="btn sec sm" onClick={() => setOpen(!open)}>
            Menu
          </button>
        </div>
        <aside className={`side ${open ? "open" : ""}`}>
          <div className="brand">
            <Logo size={32} />
            {BRAND}
          </div>
          {NAV.map(([k, label, icon]) => (
            <button
              key={k}
              className={`item ${tab === k ? "on" : ""}`}
              onClick={() => {
                setTab(k);
                setOpen(false);
              }}
            >
              <Icon name={icon} size={18} />
              {label}
              {k === "withdrawals" && pending + pendingP > 0 && <span className="cnt">{pending + pendingP}</span>}
              {k === "usdt" && pendingU > 0 && <span className="cnt">{pendingU}</span>}
            </button>
          ))}
          <div className="grow" />
          <button className="item" onClick={logout}>
            <Icon name="logout" size={18} /> Sign out
          </button>
        </aside>
        <main className="main">
          {tab === "dashboard" && <Dashboard call={call} go={setTab} />}
          {tab === "users" && <Users call={call} />}
          {tab === "sites" && <Sites call={call} />}
          {tab === "tasks" && <Tasks call={call} />}
          {tab === "withdrawals" && <Withdrawals call={call} />}
          {tab === "rewards" && <RewardsPage call={call} />}
          {tab === "usdt" && <UsdtDesk call={call} />}
          {tab === "market" && <MarketPage call={call} />}
          {tab === "shops" && <ShopsPage call={call} />}
          {tab === "support" && <SupportPage call={call} />}
          {tab === "engage" && <EngagePage call={call} />}
          {tab === "fraud" && <Fraud call={call} />}
          {tab === "settings" && <SettingsPage call={call} />}
          {tab === "channel" && <Channel call={call} />}
          {tab === "logs" && <Logs call={call} />}
        </main>
      </div>
      </CptCtx.Provider>
    </>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      const r: any = await api("admin-login", { password: pw });
      sessionStorage.setItem("adm", r.token);
      onDone();
    } catch (e: any) {
      setErr(em(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <div className="box">
        <Logo size={64} />
        <h1 style={{ fontSize: 20, margin: "12px 0 2px" }}>{BRAND} Admin</h1>
        <div className="muted sm" style={{ marginBottom: 14 }}>
          Sign in to manage your app
        </div>
        <input type="password" placeholder="Admin password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
        {err && <div className="banner err">{err}</div>}
        <button className="btn block" style={{ marginTop: 12 }} disabled={busy || !pw} onClick={go}>
          Sign in
        </button>
        {tg()?.initData ? <div className="xs muted" style={{ marginTop: 10 }}>Your Telegram ID isn't in ADMIN_TELEGRAM_IDS.</div> : null}
      </div>
    </div>
  );
}

function Head2({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="ph">
      <div>
        <h1>{title}</h1>
        {sub && <div className="muted sm" style={{ marginTop: 2 }}>{sub}</div>}
      </div>
      <div className="toolbar" style={{ margin: 0 }}>{children}</div>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)} aria-pressed={on} />;
}

/* ---------------- Dashboard ---------------- */
function Dashboard({ call, go }: { call: Call; go: (t: Tab) => void }) {
  const tf = useTf();
  const [d, setD] = useState<any>(null);
  const load = useCallback(async () => setD(await call({ action: "stats" })), [call]);
  useEffect(() => {
    load();
  }, [load]);
  if (!d) return <div className="empty">Loading…</div>;
  const max = Math.max(1, ...d.days.map((x: any) => x.active));
  return (
    <>
      <Head2 title="Dashboard" sub="A quick look at how things are going">
        <button className="btn sec sm" onClick={load}>
          <Icon name="refresh" size={15} /> Refresh
        </button>
      </Head2>
      <div className="kpis">
        <div className="kpi"><div className="k"><Icon name="users" size={15} /> Total users</div><div className="v num">{fmt(d.usersTotal)}</div><div className="d">+{fmt(d.joinedToday)} today</div></div>
        <div className="kpi"><div className="k"><Icon name="activity" size={15} /> Active today</div><div className="v num">{fmt(d.activeToday)}</div></div>
        <div className="kpi" style={{ cursor: "pointer" }} onClick={() => go("withdrawals")}><div className="k"><Icon name="clock" size={15} /> Pending payouts</div><div className="v num">{fmt(d.pending.count)}</div><div className="d">{tf(d.pending.amount)} TFUEL</div></div>
        <div className="kpi"><div className="k"><Icon name="check" size={15} /> Paid out</div><div className="v num">{fmt(d.paid.count)}</div><div className="d">{tf(d.paid.amount)} TFUEL</div></div>
        <div className="kpi" style={{ cursor: "pointer" }} onClick={() => go("usdt")}><div className="k"><Icon name="download" size={15} /> USDT to review</div><div className="v num">{fmt(d.usdt.pendingDeposits.count + d.usdt.pendingPayouts.count)}</div><div className="d">{d.usdt.pendingDeposits.count} deposits · {d.usdt.pendingPayouts.count} payouts</div></div>
        <div className="kpi"><div className="k"><Icon name="wallet" size={15} /> USDT owed to users</div><div className="v num">{d.usdt.liability.toFixed(2)}</div><div className="d">Trade volume {d.usdt.volume.toFixed(2)} · fees {d.usdt.fees.toFixed(2)}</div></div>
        <div className="kpi"><div className="k"><Icon name="lock" size={15} /> Staked (active)</div><div className="v num">{tf(d.staking?.locked)}</div><div className="d">TFUEL locked · reward owed {tf(d.staking?.owed)}</div></div>
        <div className="kpi"><div className="k"><Icon name="wallet" size={15} /> TFUEL owed to users</div><div className="v num">{tf(d.liability.total)}</div><div className="d">across {fmt(d.liability.users)} users</div></div>
      </div>
      <div className="cols">
        <div className="card">
          <div className="title">Active users · last 7 days</div>
          <div className="chart">
            {d.days.map((x: any) => (
              <div className="col" key={x.day}>
                <span className="xs num muted">{x.active}</span>
                <div className="bar2" style={{ height: `${(x.active / max) * 80}%` }} />
                <span className="xs muted">{x.day.slice(6)}/{x.day.slice(4, 6)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="title">Top balances</div>
          <table className="tbl">
            <tbody>
              {d.liability.top.map((u: any) => (
                <tr key={u.id}><td>{u.name || u.id}<div className="xs muted">ID {u.id}</div></td><td className="num b" style={{ textAlign: "right" }}>{tf(u.balance)}</td></tr>
              ))}
              {d.liability.top.length === 0 && <tr><td className="muted">No users yet</td></tr>}
            </tbody>
          </table>
          <div className="xs muted" style={{ marginTop: 6 }}>Totals refresh about every 5 minutes.</div>
        </div>
      </div>
    </>
  );
}

/* ---------------- Users ---------------- */
function Users({ call }: { call: Call }) {
  const tf = useTf();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const search = useCallback(async () => {
    const d: any = await call({ action: "users", q });
    if (d) setRows(d.users);
  }, [call, q]);
  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <Head2 title="Users" sub="Search by Telegram ID, name or @username" />
      <div className="toolbar">
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        <button className="btn sm" onClick={search}><Icon name="search" size={15} /> Search</button>
      </div>
      <div className="card scroll-x" style={{ padding: 4 }}>
        <table className="tbl">
          <thead><tr><th>User</th><th>TFUEL</th><th>Joined</th><th>Last seen</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="click" onClick={() => setSel(u.id)}>
                <td><div className="b">{u.name || "—"}</div><div className="xs muted">{u.username ? "@" + u.username + " · " : ""}ID {u.id}</div></td>
                <td className="num b">{tf(u.balance)}</td>
                <td>{when(u.created_at)}</td>
                <td>{when(u.last_seen)}</td>
                <td>{u.banned ? <span className="tag err">Banned</span> : <span className="tag ok">Active</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="empty">No users found</td></tr>}
          </tbody>
        </table>
      </div>
      {sel && <UserModal uid={sel} call={call} onClose={() => { setSel(null); search(); }} />}
    </>
  );
}

function UserModal({ uid, call, onClose }: { uid: string; call: Call; onClose: () => void }) {
  const tf = useTf();
  const [d, setD] = useState<any>(null);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const load = useCallback(async () => setD(await call({ action: "user", uid })), [call, uid]);
  useEffect(() => {
    load();
  }, [load]);
  if (!d) return <Modal onClose={onClose}><div className="empty">Loading…</div></Modal>;
  const u = d.user;
  const adjust = async (sign: 1 | -1) => {
    const n = parseInt(delta, 10);
    if (!n) return;
    if (await call({ action: "adjustBalance", uid, delta: sign * Math.abs(n), reason }, "Balance updated")) {
      setDelta("");
      setReason("");
      load();
    }
  };
  const ban = async () => {
    const r = u.banned ? "" : prompt("Reason for banning this user?") || "";
    if (!u.banned && !r) return;
    if (await call({ action: "banUser", uid, banned: !u.banned, reason: r }, u.banned ? "User unbanned" : "User banned")) load();
  };
  const f = d.flags || {};
  return (
    <Modal onClose={onClose}>
      <div className="row">
        <div>
          <h2 style={{ margin: 0 }}>{u.name || "User"}</h2>
          <div className="muted sm">{u.username ? "@" + u.username + " · " : ""}ID {u.id}</div>
        </div>
        <button className="btn sec sm" onClick={onClose}><Icon name="x" size={15} /></button>
      </div>
      <div className="grid3" style={{ margin: "14px 0" }}>
        <div className="kpi"><div className="k">TFUEL · USDT</div><div className="v num" style={{ fontSize: 18 }}>{tf(u.balance)} · {(u.usdt || 0).toFixed(2)}</div></div>
        <div className="kpi"><div className="k">Tasks done</div><div className="v num" style={{ fontSize: 20 }}>{u.tasks_done}</div></div>
        <div className="kpi"><div className="k">Joined</div><div className="v" style={{ fontSize: 14 }}>{when(u.created_at)}</div></div>
      </div>
      {u.banned && <div className="banner err"><Icon name="ban" size={18} /><span>Banned{u.ban_reason ? `: ${u.ban_reason}` : ""}</span></div>}
      <div className="xs muted">Flags: fast taps {f.too_fast || 0} · wrong codes {f.bad_codes || 0} · locked {f.locked || 0} · out-of-order {f.out_of_order || 0}</div>

      <label>Adjust balance (coins; 1 TFUEL = units shown in Settings)</label>
      <div className="grid2">
        <input inputMode="numeric" placeholder="Amount" value={delta} onChange={(e) => setDelta(e.target.value.replace(/\D/g, ""))} />
        <input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button className="btn good sm" disabled={!delta || reason.length < 3} onClick={() => adjust(1)}><Icon name="plus" size={15} /> Add</button>
        <button className="btn danger sm" disabled={!delta || reason.length < 3} onClick={() => adjust(-1)}>Deduct</button>
        <span style={{ flex: 1 }} />
        <button className="btn sec sm" onClick={async () => { if (confirm("Remove this user's withdraw PIN?")) await call({ action: "resetPin", uid }, "PIN reset"); }}><Icon name="lock" size={15} /> Reset PIN</button>
        <button className={`btn sm ${u.banned ? "sec" : "danger"}`} onClick={ban}><Icon name="ban" size={15} /> {u.banned ? "Unban" : "Ban user"}</button>
      </div>

      <h2>Recent withdrawals</h2>
      {d.withdrawals.length === 0 && <div className="muted sm">None</div>}
      {d.withdrawals.map((w: any) => (
        <div className="hist" key={w.id}>
          <span>{fmt(w.amount)} · {w.method}</span>
          <span className={`tag ${w.status === "paid" ? "ok" : w.status === "rejected" ? "err" : "warn"}`}>{w.status}</span>
        </div>
      ))}
    </Modal>
  );
}

/* ---------------- Article sites ---------------- */
function Sites({ call }: { call: Call }) {
  const [sites, setSites] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const load = useCallback(async () => {
    const d: any = await call({ action: "list" });
    if (d) setSites(d.sites);
  }, [call]);
  useEffect(() => {
    load();
  }, [load]);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const copy = (s: string) => navigator.clipboard?.writeText(s);
  return (
    <>
      <Head2 title="Article Sites" sub="Each site is a chain of articles. The code appears on the last one.">
        <button className="btn" onClick={() => setEdit({ name: "", urls: "", reward: 500, cooldown_minutes: 60, dwell_seconds: 15, lock_seconds: 5, is_active: true })}>
          <Icon name="plus" size={16} /> New site
        </button>
      </Head2>
      <div className="card">
        <div className="title">Embed script</div>
        <div className="sub" style={{ marginBottom: 8 }}>Add this line once to every article page (Blogger: Theme → Edit HTML → before &lt;/body&gt;).</div>
        <pre>{`<script src="${origin}/chain.js" async></script>`}</pre>
        <button className="btn sec sm" style={{ marginTop: 8 }} onClick={() => copy(`<script src="${origin}/chain.js" async></script>`)}><Icon name="copy" size={15} /> Copy</button>
      </div>
      <div className="card scroll-x" style={{ padding: 4 }}>
        <table className="tbl">
          <thead><tr><th>Site</th><th>Reward</th><th>Cooldown</th><th>Started</th><th>Reached code</th><th>Claimed</th><th>Status</th><th /></tr></thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id}>
                <td><div className="b">{s.name}</div><div className="xs muted">{s.urls?.length} articles · {s.dwell_seconds}s each ({s.lock_seconds ?? 5}s top read + {s.dwell_seconds - (s.lock_seconds ?? 5)}s scroll)</div></td>
                <td className="num">{fmt(s.reward)}</td>
                <td>{s.cooldown_minutes}m</td>
                <td className="num">{s.stats.started}</td>
                <td className="num">{s.stats.finished}</td>
                <td className="num">{s.stats.claimed}</td>
                <td><span className={`tag ${s.is_active ? "ok" : ""}`}>{s.is_active ? "Active" : "Paused"}</span></td>
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  <button className="btn sec sm" onClick={() => setEdit({ ...s, urls: (s.urls || []).join("\n") })}><Icon name="edit" size={14} /></button>{" "}
                  <button className="btn sec sm" onClick={async () => { if (await call({ action: "toggleSite", siteId: s.id, active: !s.is_active })) load(); }}>{s.is_active ? "Pause" : "Enable"}</button>{" "}
                  <button className="btn sec sm" onClick={async () => { if (confirm(`Delete "${s.name}"?`) && (await call({ action: "deleteSite", siteId: s.id }, "Deleted"))) load(); }}><Icon name="trash" size={14} /></button>
                </td>
              </tr>
            ))}
            {sites.length === 0 && <tr><td colSpan={8} className="empty">No sites yet. Add your first one.</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal onClose={() => setEdit(null)}>
          <h2 style={{ marginTop: 0 }}>{edit.id ? "Edit site" : "New article site"}</h2>
          <label>Site name</label>
          <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <label>Article URLs, one per line, in reading order (2–10, same domain, https)</label>
          <textarea rows={6} value={edit.urls} onChange={(e) => setEdit({ ...edit, urls: e.target.value })} placeholder={"https://example.com/part-1\nhttps://example.com/part-2"} />
          <div className="grid3">
            <div><label>Reward (coins)</label><input inputMode="numeric" value={edit.reward} onChange={(e) => setEdit({ ...edit, reward: e.target.value })} /><Hint coins={edit.reward} /></div>
            <div><label>Cooldown (min)</label><input inputMode="numeric" value={edit.cooldown_minutes} onChange={(e) => setEdit({ ...edit, cooldown_minutes: e.target.value })} /></div>
            <div><label>Seconds per article</label><input inputMode="numeric" value={edit.dwell_seconds} onChange={(e) => setEdit({ ...edit, dwell_seconds: e.target.value })} /></div>
          </div>
          <label>Top-read lock (seconds)</label>
          <input inputMode="numeric" value={edit.lock_seconds ?? 5} onChange={(e) => setEdit({ ...edit, lock_seconds: e.target.value })} />
          <div className="xs muted" style={{ marginTop: 4 }}>The reader must stay at the top of the article for this long (scrolling is locked). After that they can scroll for the rest of the time. Example: 15 total = 5 locked + 10 scrolling.</div>
          <div className="toolbar" style={{ marginTop: 14, justifyContent: "flex-end" }}>
            <button className="btn sec" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn" onClick={async () => { if (await call({ action: "saveSite", siteId: edit.id, ...edit }, "Saved")) { setEdit(null); load(); } }}>Save</button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------------- Tasks ---------------- */
function Tasks({ call }: { call: Call }) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [f, setF] = useState<any>({ type: "telegram_join", title: "", reward: 500, channel_id: "", url: "", min_wait_seconds: 10 });
  const load = useCallback(async () => {
    const d: any = await call({ action: "list" });
    if (d) setTasks(d.tasks);
  }, [call]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <>
      <Head2 title="Tasks" sub="One-time tasks: join a Telegram channel or visit a link" />
      <div className="cols">
        <div className="card">
          <div className="title">Add a task</div>
          <label>Type</label>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="telegram_join">Join a Telegram channel</option>
            <option value="timer_visit">Visit a link (timer)</option>
          </select>
          <label>Title</label>
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <label>Reward (coins)</label>
          <input inputMode="numeric" value={f.reward} onChange={(e) => setF({ ...f, reward: e.target.value })} />
          <Hint coins={f.reward} />
          {f.type === "telegram_join" ? (
            <>
              <label>Channel (@username or -100…)</label>
              <input value={f.channel_id} onChange={(e) => setF({ ...f, channel_id: e.target.value })} placeholder="@mychannel" />
              <div className="xs muted" style={{ marginTop: 4 }}>The bot must be an administrator of the channel. Use “Channel check” to test.</div>
            </>
          ) : (
            <>
              <label>Link (https)</label>
              <input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
              <label>Wait (seconds)</label>
              <input inputMode="numeric" value={f.min_wait_seconds} onChange={(e) => setF({ ...f, min_wait_seconds: e.target.value })} />
            </>
          )}
          <button className="btn block" style={{ marginTop: 14 }} onClick={async () => { if (await call({ action: "saveTask", ...f }, "Task added")) { setF({ ...f, title: "" }); load(); } }}>
            <Icon name="plus" size={16} /> Add task
          </button>
        </div>
        <div className="card">
          <div className="title" style={{ marginBottom: 6 }}>Current tasks</div>
          {tasks.length === 0 && <div className="empty">No tasks yet</div>}
          {tasks.map((t) => (
            <div className="hist" key={t.id}>
              <div>
                <div className="b">{t.title}</div>
                <div className="xs muted">{t.type === "telegram_join" ? `Join ${t.channel_id}` : `Visit · ${t.min_wait_seconds}s`} · +{fmt(t.reward)}</div>
              </div>
              <button className="btn sec sm" onClick={async () => { if (confirm("Delete this task?") && (await call({ action: "deleteTask", taskId: t.id }, "Deleted"))) load(); }}><Icon name="trash" size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------------- Withdrawals (USDT + TFUEL/other) ---------------- */
function Withdrawals({ call }: { call: Call }) {
  const tf = useTf();
  const [kind, setKind] = useState<"usdt" | "coin">("usdt");
  const [rows, setRows] = useState<any[]>([]);
  const [urows, setUrows] = useState<any[]>([]);
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const d: any = await call({ action: "list" });
    if (d) setRows(d.withdrawals);
    const u: any = await call({ action: "usdtWithdrawals" });
    if (u) setUrows(u.items);
  }, [call]);
  useEffect(() => {
    load();
  }, [load]);
  const src = kind === "usdt" ? urows : rows;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return src.filter((w) => (status === "all" || w.status === status) && (!s || [w.uid, w.name, w.account, w.address, w.method, w.network_name].some((x) => String(x || "").toLowerCase().includes(s))));
  }, [src, status, q]);
  const pendU = urows.filter((w) => w.status === "pending").length;
  const pendC = rows.filter((w) => w.status === "pending").length;
  const csv = () => {
    const head = ["id", "date", "user_id", "name", "amount", "fee", "method", "account", "status", "note"];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.join(",")].concat(shown.map((w) => [w.id, new Date(w.created_at).toISOString(), w.uid, w.name, w.amount, w.fee ?? "", w.network_name || w.method, w.address || w.account, w.status, w.note].map(esc).join(",")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `withdrawals-${kind}.csv`;
    a.click();
  };
  const act = async (id: string, pay: boolean) => {
    if (!pay && !confirm(kind === "usdt" ? "Reject and refund the USDT to the user?" : "Reject and refund the coins to the user?")) return;
    const action = kind === "usdt" ? (pay ? "payUsdt" : "rejectUsdt") : pay ? "payWithdrawal" : "rejectWithdrawal";
    if (await call({ action, id, note: notes[id] || "" }, pay ? "Marked as paid" : "Rejected & refunded")) load();
  };
  return (
    <>
      <Head2 title="Withdrawals" sub="Pay manually, then mark as paid. Rejecting refunds the user.">
        <button className="btn sec sm" onClick={csv}><Icon name="download" size={15} /> CSV</button>
      </Head2>
      <div className="seg" style={{ marginBottom: 10 }}>
        <button className={kind === "usdt" ? "on" : ""} onClick={() => setKind("usdt")}>USDT payouts{pendU ? ` (${pendU})` : ""}</button>
        <button className={kind === "coin" ? "on" : ""} onClick={() => setKind("coin")}>TFUEL / other{pendC ? ` (${pendC})` : ""}</button>
      </div>
      <div className="toolbar">
        <div className="seg" style={{ margin: 0 }}>
          {["pending", "paid", "rejected", "all"].map((s) => (
            <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
        <input placeholder="Search user, name, address…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {shown.length === 0 && <div className="card empty">Nothing here</div>}
      {shown.map((w) => {
        const acc = w.address || w.account || "";
        return (
          <div className="card" key={w.id}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div>
                {kind === "usdt" ? (
                  <>
                    <div className="b num" style={{ fontSize: 17 }}>{Number(w.amount).toFixed(2)} USDT</div>
                    <div className="sm"><b>Send {Number(w.receive).toFixed(2)} USDT</b> (fee {Number(w.fee || 0).toFixed(2)}) · {w.network_name}</div>
                  </>
                ) : (
                  <>
                    <div className="b num" style={{ fontSize: 17 }}>{tf(w.amount)} TFUEL</div>
                    <div className="sm">{w.method}</div>
                  </>
                )}
                <div className="sm"><b style={{ userSelect: "text", wordBreak: "break-all" }}>{acc}</b> <button className="btn ghost sm" style={{ padding: 2 }} onClick={() => navigator.clipboard?.writeText(acc)}><Icon name="copy" size={14} /></button></div>
                <div className="xs muted">{w.name} · ID {w.uid} · {when(w.created_at)}</div>
                {w.note && <div className="xs" style={{ marginTop: 4 }}>Note: {w.note}</div>}
              </div>
              <span className={`tag ${w.status === "paid" ? "ok" : w.status === "rejected" ? "err" : "warn"}`}>{w.status}</span>
            </div>
            {w.status === "pending" && (
              <>
                <input style={{ marginTop: 10 }} placeholder="Note / transaction ID (optional)" value={notes[w.id] || ""} onChange={(e) => setNotes({ ...notes, [w.id]: e.target.value })} />
                <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
                  <button className="btn good sm" onClick={() => act(w.id, true)}><Icon name="check" size={15} /> Mark paid</button>
                  <button className="btn danger sm" onClick={() => act(w.id, false)}>Reject & refund</button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ---------------- Fraud ---------------- */
function Fraud({ call }: { call: Call }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    call({ action: "fraud" }).then(setD);
  }, [call]);
  if (!d) return <div className="empty">Loading…</div>;
  return (
    <>
      <Head2 title="Fraud monitor" sub="Accounts showing suspicious behaviour. Review before banning." />
      <div className="card scroll-x" style={{ padding: 4 }}>
        <div className="title" style={{ padding: "10px 10px 0" }}>Flagged users</div>
        <table className="tbl">
          <thead><tr><th>User</th><th>Score</th><th>Fast taps</th><th>Wrong codes</th><th>Locked</th><th>Out of order</th><th>Last</th></tr></thead>
          <tbody>
            {d.flagged.map((u: any) => (
              <tr key={u.uid}><td><div className="b">{u.name || "—"}</div><div className="xs muted">ID {u.uid}</div></td><td className="num b">{u.score}</td><td>{u.too_fast || 0}</td><td>{u.bad_codes || 0}</td><td>{u.locked || 0}</td><td>{u.out_of_order || 0}</td><td>{when(u.last_at)}</td></tr>
            ))}
            {d.flagged.length === 0 && <tr><td colSpan={7} className="empty">No flagged users</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="title">Shared payout accounts</div>
        <div className="sub" style={{ marginBottom: 6 }}>The same account used by more than one user — often multi-accounting.</div>
        {d.shared.length === 0 && <div className="empty">None found</div>}
        {d.shared.map((s: any) => (
          <div className="hist" key={s.account}>
            <div><div className="b" style={{ userSelect: "text" }}>{s.account}</div><div className="xs muted">{s.method}</div></div>
            <div className="xs">Users: {s.users.join(", ")}</div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- Settings ---------------- */
function SettingsPage({ call }: { call: Call }) {
  const [s, setS] = useState<any>(null);
  useEffect(() => {
    call({ action: "getSettings" }).then((d: any) => d && setS({ ...d.settings, withdraw_methods: d.settings.withdraw_methods.join(", ") }));
  }, [call]);
  if (!s) return <div className="empty">Loading…</div>;
  const set = (k: string, v: any) => setS({ ...s, [k]: v });
  const ann = s.announcement;
  const save = () => call({ action: "saveSettings", settings: { ...s, withdraw_methods: String(s.withdraw_methods).split(",") } }, "Settings saved");
  return (
    <>
      <Head2 title="Settings" sub="Changes apply to all users within about 15 seconds">
        <button className="btn" onClick={save}>Save changes</button>
      </Head2>

      <div className="card">
        <div className="row"><div><div className="title">Maintenance mode</div><div className="sub">Blocks the app for everyone and shows your message</div></div><Toggle on={s.maintenance} onChange={(v) => set("maintenance", v)} /></div>
        <label>Message shown to users</label>
        <input value={s.maintenance_msg} onChange={(e) => set("maintenance_msg", e.target.value)} />
      </div>

      <div className="card">
        <div className="row"><div><div className="title">Announcement banner</div><div className="sub">Shown at the top of the app</div></div><Toggle on={ann.enabled} onChange={(v) => set("announcement", { ...ann, enabled: v })} /></div>
        <label>Text</label>
        <input value={ann.text} maxLength={240} onChange={(e) => set("announcement", { ...ann, text: e.target.value })} />
        <label>Style</label>
        <select value={ann.kind} onChange={(e) => set("announcement", { ...ann, kind: e.target.value })}>
          <option value="info">Info (blue)</option><option value="warn">Warning (amber)</option><option value="success">Good news (green)</option>
        </select>
      </div>

      <div className="card">
        <div className="title">Game</div>
        <div className="grid3">
          <div><label>Coins per tap</label><input inputMode="numeric" value={s.earn_per_tap} onChange={(e) => set("earn_per_tap", e.target.value)} /></div>
          <div><label>Max energy</label><input inputMode="numeric" value={s.max_energy} onChange={(e) => set("max_energy", e.target.value)} /></div>
          <div><label>Energy cost per tap</label><input inputMode="decimal" value={s.energy_cost} onChange={(e) => set("energy_cost", e.target.value)} /></div>
          <div><label>Full refill after empty (hours)</label><input inputMode="decimal" value={s.empty_refill_hours} onChange={(e) => set("empty_refill_hours", e.target.value)} /></div>
          <div><label>Slow regen / sec (0 = off)</label><input inputMode="decimal" value={s.energy_regen} onChange={(e) => set("energy_regen", e.target.value)} /></div>
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>When a user's energy runs out, it refills to full after the hours above. Keep slow regen at 0 so the wait is the only way to refill (boosts with regen still work).</div>
      </div>

      <div className="card">
        <div className="row"><div><div className="title">Other payout methods (optional)</div><div className="sub">Manual payouts outside USDT. Leave the list empty to hide it. Users withdraw USDT from the TFUEL tab.</div></div><Toggle on={s.withdraw_enabled} onChange={(v) => set("withdraw_enabled", v)} /></div>
        <div className="grid3">
          <div><label>Minimum (coins)</label><input inputMode="numeric" value={s.min_withdraw} onChange={(e) => set("min_withdraw", e.target.value)} /><Hint coins={s.min_withdraw} /></div>
          <div><label>New users wait (days)</label><input inputMode="numeric" value={s.new_user_wait_days} onChange={(e) => set("new_user_wait_days", e.target.value)} /></div>
          <div><label>Max requests / day (0 = no limit)</label><input inputMode="numeric" value={s.daily_withdraw_limit} onChange={(e) => set("daily_withdraw_limit", e.target.value)} /></div>
        </div>
        <label>Payment methods (comma separated)</label>
        <input value={s.withdraw_methods} onChange={(e) => set("withdraw_methods", e.target.value)} placeholder="bKash, Nagad, USDT (TRC20)" />
      </div>
    </>
  );
}

/* ---------------- Channel check ---------------- */
function Channel({ call }: { call: Call }) {
  const [ch, setCh] = useState("");
  const [r, setR] = useState<any>(null);
  const [diag, setDiag] = useState<any[]>([]);
  useEffect(() => {
    call({ action: "diagnostics" }).then((d: any) => d && setDiag(d.items));
  }, [call]);
  return (
    <>
      <Head2 title="Channel check" sub="Test that the bot can verify members of a channel" />
      <div className="card">
        <label style={{ marginTop: 0 }}>Channel (@username or -100…)</label>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <input value={ch} onChange={(e) => setCh(e.target.value)} placeholder="@mychannel" style={{ maxWidth: "none" }} />
          <button className="btn" onClick={async () => setR(await call({ action: "checkChannel", channel_id: ch }))}>Check</button>
        </div>
        {r && (
          <div className={`banner ${r.ok ? "success" : "err"}`} style={{ marginBottom: 0 }}>
            <Icon name={r.ok ? "check" : "alert"} size={18} />
            <span>
              {r.message}
              {r.bot && <div className="xs">Bot: @{r.bot}{r.title ? ` · Channel: ${r.title}` : ""}{r.status ? ` · Bot status: ${r.status}` : ""}</div>}
            </span>
          </div>
        )}
      </div>
      <div className="card">
        <div className="title">Recent verification problems</div>
        <div className="sub" style={{ marginBottom: 6 }}>Users only see a friendly message. The real reason is here.</div>
        {diag.length === 0 && <div className="empty">No problems recorded</div>}
        {diag.map((d) => (
          <div className="hist" key={d.taskId}>
            <div><div className="b">{d.title || d.channel}</div><div className="xs muted">{d.channel} · {when(d.at)}</div></div>
            <div className="xs" style={{ maxWidth: 260, textAlign: "right" }}>{d.reason}</div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- Logs ---------------- */
function Logs({ call }: { call: Call }) {
  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => {
    call({ action: "logs" }).then((d: any) => d && setLogs(d.logs));
  }, [call]);
  return (
    <>
      <Head2 title="Activity log" sub="Every admin change, newest first" />
      <div className="card scroll-x" style={{ padding: 4 }}>
        <table className="tbl">
          <thead><tr><th>When</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}><td style={{ whiteSpace: "nowrap" }}>{when(l.at)}</td><td><span className="tag info">{l.action}</span></td><td className="xs" style={{ wordBreak: "break-word" }}>{Object.entries(l.detail || {}).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")}</td></tr>
            ))}
            {logs.length === 0 && <tr><td colSpan={3} className="empty">No activity yet</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------- Binance auto-approve ---------------- */
function BinanceCard({ s, set, call }: { s: any; set: (k: string, v: any) => void; call: Call }) {
  const [st, setSt] = useState<any>(null);
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const load = useCallback(async () => setSt(await call({ action: "binanceStatus" })), [call]);
  useEffect(() => { load(); }, [load]);
  const last = st?.last;
  return (
    <div className="card">
      <div className="row"><div><div className="title">Binance auto-approve</div><div className="sub">Matches each deposit TxID against your Binance deposit history and credits it automatically. Only deposits that match the exact address, network, coin and amount are credited.</div></div><Toggle on={!!s.binance_auto} onChange={(v) => set("binance_auto", v)} /></div>
      <div className="banner warn" style={{ marginTop: 12 }}><Icon name="alert" size={18} /><span>Create the API key in Binance with <b>only “Enable Reading”</b>. Keys that can trade, withdraw or transfer are rejected. The secret is encrypted before it&apos;s stored and is never shown again. Your deposit addresses must be your Binance USDT deposit addresses. Binance can block servers in some regions — use “Test connection” after saving.</span></div>
      {st?.key ? (
        <div className="row" style={{ marginTop: 12 }}>
          <div><div className="b">Key {st.key.hint} <span className="muted sm">· from {st.key.src === "env" ? "server settings" : "this panel"}</span></div>
            {last && <div className={`xs ${last.ok ? "" : "muted"}`}><span className={`tag ${last.ok ? "ok" : "err"}`}>{last.ok ? "OK" : "Problem"}</span> {last.msg} · {when(last.at)}</div>}</div>
          <div className="gap">
            <button className="btn sec sm" onClick={async () => { await call({ action: "binanceTest" }, "Checked"); load(); }}>Test connection</button>
            {st.key.src === "db" && <button className="btn danger sm" onClick={async () => { if (confirm("Remove the saved Binance key?")) { await call({ action: "binanceClear" }, "Removed"); load(); } }}>Remove</button>}
          </div>
        </div>
      ) : (
        <div className="grid2" style={{ marginTop: 12 }}>
          <div><label style={{ marginTop: 0 }}>API key</label><input autoComplete="off" value={key} onChange={(e) => setKey(e.target.value.trim())} /></div>
          <div><label style={{ marginTop: 0 }}>Secret key</label><input autoComplete="off" type="password" value={secret} onChange={(e) => setSecret(e.target.value.trim())} /></div>
          <div><button className="btn sm" disabled={key.length < 20 || secret.length < 20} onClick={async () => { if (await call({ action: "binanceSave", key, secret }, "Key verified and saved")) { setKey(""); setSecret(""); load(); } }}>Verify & save key</button></div>
        </div>
      )}
      <label>Auto-approve limit per deposit (USDT)</label>
      <input inputMode="decimal" value={s.binance_auto_max} onChange={(e) => set("binance_auto_max", e.target.value)} />
      <div className="xs muted" style={{ marginTop: 6 }}>Larger deposits are still verified, but wait for your approval. Remember to press “Save changes” at the top. Pending deposits are rechecked by the cron job and when the user presses recheck.</div>
      <button className="btn sec sm" style={{ marginTop: 10 }} onClick={async () => { const d: any = await call({ action: "binanceRecheck" }); if (d) alert(`Checked ${d.checked}, approved ${d.approved}`); }}>Recheck pending now</button>
    </div>
  );
}


/* ---------------- Binance ID + Telegram Stars deposit methods ---------------- */
function MoreDeposits({ s, set, call }: { s: any; set: (k: string, v: any) => void; call: Call }) {
  const [st, setSt] = useState<any>(null);
  const load = useCallback(async () => setSt(await call({ action: "starsStatus" })), [call]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div className="card">
        <div className="row"><div><div className="title">Binance ID deposits</div><div className="sub">Users send USDT to your Binance ID (internal transfer / Binance Pay — no network fee). Needs Binance auto-approve with a saved key. Matched by the exact amount we give the user.</div></div><Toggle on={!!s.binance_id_enabled} onChange={(v) => set("binance_id_enabled", v)} /></div>
        <div className="grid2">
          <div><label>Your Binance ID / Pay ID</label><input inputMode="numeric" value={s.binance_id} placeholder="e.g. 123456789" onChange={(e) => set("binance_id", e.target.value.replace(/\D/g, ""))} /></div>
          <div><label>Minimum (USDT)</label><input inputMode="decimal" value={s.binance_id_min} onChange={(e) => set("binance_id_min", e.target.value)} /></div>
        </div>
      </div>
      <div className="card">
        <div className="row"><div><div className="title">Pay with Telegram Stars</div><div className="sub">Users buy USDT balance with Stars inside Telegram. Turn off any time.</div></div><Toggle on={!!s.stars_enabled} onChange={(v) => set("stars_enabled", v)} /></div>
        <div className="grid3">
          <div><label>Stars per 1 USDT</label><input inputMode="decimal" value={s.stars_per_usdt} onChange={(e) => set("stars_per_usdt", e.target.value)} /></div>
          <div><label>Min (USDT)</label><input inputMode="decimal" value={s.stars_min_usdt} onChange={(e) => set("stars_min_usdt", e.target.value)} /></div>
          <div><label>Max (USDT)</label><input inputMode="decimal" value={s.stars_max_usdt} onChange={(e) => set("stars_max_usdt", e.target.value)} /></div>
        </div>
        <div className="xs muted" style={{ marginTop: 8 }}>Telegram pays you roughly $0.013 per Star after fees, so set the rate with a margin (77 Stars ≈ $1.00 gross). Remember “Save changes”.</div>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="sm">{st ? (st.connected ? <span className="tag ok">Payments connected</span> : <span className="tag warn">Not connected</span>) : "…"}{st?.error ? <span className="xs muted"> · last error: {st.error}</span> : null}</div>
          <button className="btn sec sm" onClick={async () => { if (await call({ action: "starsConnect" }, "Connected")) load(); }}>{st?.connected ? "Reconnect" : "Connect Telegram payments"}</button>
        </div>
        <div className="xs muted" style={{ marginTop: 6 }}>Connecting points your bot&apos;s webhook to this site so Telegram can confirm payments. Do this once after deploying.</div>
      </div>
    </>
  );
}

/* ---------------- USDT desk ---------------- */
function UsdtDesk({ call }: { call: Call }) {
  const tf = useTf();
  const [sub, setSub] = useState<"deposits" | "payouts" | "trades">("deposits");
  const [items, setItems] = useState<any[]>([]);
  const [amt, setAmt] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("pending");
  const load = useCallback(async () => {
    const a = sub === "deposits" ? "deposits" : sub === "payouts" ? "usdtWithdrawals" : "trades";
    const d: any = await call({ action: a });
    if (d) setItems(d.items);
  }, [call, sub]);
  useEffect(() => {
    setItems([]);
    load();
  }, [load]);
  const shown = items.filter((x) => sub === "trades" || filter === "all" || x.status === filter);
  const act = async (action: string, id: string, extra: Record<string, any> = {}, msg = "Done") => {
    if (await call({ action, id, note: note[id] || "", ...extra }, msg)) load();
  };
  return (
    <>
      <Head2 title="USDT desk" sub="Check every deposit on the blockchain before approving. Send payouts yourself, then mark them paid." />
      <div className="toolbar">
        <div className="seg" style={{ margin: 0 }}>
          {(["deposits", "payouts", "trades"] as const).map((k) => <button key={k} className={sub === k ? "on" : ""} onClick={() => setSub(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}
        </div>
        {sub !== "trades" && (
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="pending">Pending</option><option value="all">All</option>
            {sub === "deposits" ? <><option value="approved">Approved</option><option value="rejected">Rejected</option></> : <><option value="paid">Paid</option><option value="rejected">Rejected</option></>}
          </select>
        )}
      </div>

      {sub === "trades" && (
        <div className="card scroll-x" style={{ padding: 4 }}>
          <table className="tbl">
            <thead><tr><th>When</th><th>User</th><th>Side</th><th>TFUEL</th><th>USDT</th><th>Price</th><th>Fee</th></tr></thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id}><td>{when(t.at)}</td><td>{t.uid}</td><td><span className={`tag ${t.side === "sell" ? "warn" : "info"}`}>{t.side}</span></td><td className="num">{tf(t.coins)}</td><td className="num">{(t.usdt_u / 1e6).toFixed(4)}</td><td className="num">{t.price}</td><td className="num">{(t.fee_u / 1e6).toFixed(4)}</td></tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={7} className="empty">No trades yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {sub === "deposits" && (shown.length === 0 ? <div className="card empty">Nothing here</div> : shown.map((d) => (
        <div className="card" key={d.id}>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="b num" style={{ fontSize: 17 }}>Claims {d.amount} USDT <span className="muted sm">· {d.network_name}</span></div>
              <div className="xs" style={{ wordBreak: "break-all", userSelect: "text", marginTop: 2 }}>TxID: {d.txid} <button className="btn ghost sm" style={{ padding: 2 }} onClick={() => navigator.clipboard?.writeText(d.txid)}><Icon name="copy" size={13} /></button></div>
              <div className="xs muted">{d.name} · ID {d.uid} · {when(d.created_at)}{d.credited ? ` · credited ${d.credited}` : ""}{d.note ? ` · ${d.note}` : ""}{d.auto_note && d.status === "pending" ? ` · ${d.auto_note}` : ""}</div>
              {d.auto && <div className="xs" style={{ marginTop: 2 }}><span className={`tag ${d.by === "binance-auto" ? "ok" : d.verified ? "ok" : "warn"}`}>{d.by === "binance-auto" ? "Auto-approved via Binance" : d.verified ? `Verified on Binance: ${d.verified} USDT` : "Binance auto-check"}</span></div>}
            </div>
            <span className={`tag ${d.status === "approved" ? "ok" : d.status === "rejected" ? "err" : "warn"}`}>{d.status}{d.by === "binance-auto" ? " · auto" : ""}</span>
          </div>
          {d.auto_note && d.status === "pending" && <div className="xs" style={{ marginTop: 6 }}>🤖 {d.auto_note}{d.verified ? ` — you can credit ${d.verified}` : ""}</div>}
          {d.status === "pending" && (
            <>
              <div className="grid2" style={{ marginTop: 10 }}>
                <input inputMode="decimal" placeholder={`Amount received (claimed ${d.amount})`} value={amt[d.id] ?? ""} onChange={(e) => setAmt({ ...amt, [d.id]: e.target.value.replace(/[^\d.]/g, "") })} />
                <input placeholder="Note (optional)" value={note[d.id] || ""} onChange={(e) => setNote({ ...note, [d.id]: e.target.value })} />
              </div>
              <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
                <button className="btn good sm" disabled={!(Number(amt[d.id]) > 0)} onClick={() => act("approveDeposit", d.id, { amount: Number(amt[d.id]) }, "Deposit credited")}><Icon name="check" size={15} /> Approve & credit</button>
                <button className="btn danger sm" onClick={() => confirm("Reject this deposit?") && act("rejectDeposit", d.id, {}, "Rejected")}>Reject</button>
              </div>
            </>
          )}
        </div>
      )))}

      {sub === "payouts" && (shown.length === 0 ? <div className="card empty">Nothing here</div> : shown.map((w) => (
        <div className="card" key={w.id}>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="b num" style={{ fontSize: 17 }}>Send {w.receive} USDT <span className="muted sm">· {w.network_name}</span></div>
              <div className="xs" style={{ wordBreak: "break-all", userSelect: "text", marginTop: 2 }}>{w.address} <button className="btn ghost sm" style={{ padding: 2 }} onClick={() => navigator.clipboard?.writeText(w.address)}><Icon name="copy" size={13} /></button></div>
              <div className="xs muted">Requested {w.amount} (fee {w.fee}) · {w.name} · ID {w.uid} · {when(w.created_at)}{w.note ? ` · ${w.note}` : ""}</div>
            </div>
            <span className={`tag ${w.status === "paid" ? "ok" : w.status === "rejected" ? "err" : "warn"}`}>{w.status}</span>
          </div>
          {w.status === "pending" && (
            <>
              <input style={{ marginTop: 10 }} placeholder="Transaction ID / note" value={note[w.id] || ""} onChange={(e) => setNote({ ...note, [w.id]: e.target.value })} />
              <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
                <button className="btn good sm" onClick={() => act("payUsdt", w.id, {}, "Marked as paid")}><Icon name="check" size={15} /> Mark paid</button>
                <button className="btn danger sm" onClick={() => confirm("Reject and refund USDT to the user?") && act("rejectUsdt", w.id, {}, "Rejected & refunded")}>Reject & refund</button>
              </div>
            </>
          )}
        </div>
      )))}
    </>
  );
}

/* ---------------- Market & Trading ---------------- */
const PRESETS: Record<string, string> = { TRC20: "^T[1-9A-HJ-NP-Za-km-z]{33}$", "ERC20 / BEP20": "^0x[a-fA-F0-9]{40}$" };

function MarketPage({ call }: { call: Call }) {
  const [s, setS] = useState<any>(null);
  const [st, setSt] = useState<any>(null);
  const loadStatus = useCallback(async () => setSt(await call({ action: "marketStatus" })), [call]);
  useEffect(() => {
    call({ action: "getSettings" }).then((d: any) => d && setS(d.settings));
    loadStatus();
  }, [call, loadStatus]);
  if (!s) return <div className="empty">Loading…</div>;
  const set = (k: string, v: any) => setS({ ...s, [k]: v });
  const setNet = (key: string, i: number, patch: any) => set(key, s[key].map((n: any, j: number) => (j === i ? { ...n, ...patch } : n)));
  const save = async () => {
    const keys = ["trade_enabled", "buy_enabled", "sell_enabled", "coins_per_tfuel", "trade_fee_pct", "min_trade_usdt", "max_trade_usdt", "daily_trade_limit_usdt", "price_override", "deposit_enabled", "deposit_networks", "binance_auto", "binance_auto_max", "binance_id_enabled", "binance_id", "binance_id_min", "stars_enabled", "stars_per_usdt", "stars_min_usdt", "stars_max_usdt", "payout_enabled", "payout_networks"];
    const body: any = {};
    keys.forEach((k) => (body[k] = s[k]));
    const d: any = await call({ action: "saveSettings", settings: body }, "Saved");
    if (d) {
      setS(d.settings);
      loadStatus();
    }
  };
  const live = st?.live;
  return (
    <>
      <Head2 title="Market & Trading" sub="Live TFUEL price, buy/sell rules, deposit and payout networks">
        <button className="btn" onClick={save}>Save changes</button>
      </Head2>

      <div className="kpis">
        <div className="kpi"><div className="k">Price in use</div><div className="v num">{st?.price ? "$" + st.price.price : "—"}</div><div className="d">{st?.price?.override ? "Admin override" : st?.price ? `Source: ${st.price.src}` : "No price available"}</div></div>
        <div className="kpi"><div className="k">Live market price</div><div className="v num">{live ? "$" + live.price : "—"}</div><div className="d">{live ? (live.stale ? "Stale — trading paused" : `Updated ${when(live.at)}`) : "Could not fetch"}</div></div>
      </div>

      <div className="card">
        <div className="row"><div><div className="title">Trading</div><div className="sub">Master switch. Off by default.</div></div><Toggle on={s.trade_enabled} onChange={(v) => set("trade_enabled", v)} /></div>
        <div className="row" style={{ marginTop: 12 }}><div><div className="title">Allow buying coins</div><div className="sub">Users spend USDT to get coins (creates new coins — your exposure)</div></div><Toggle on={s.buy_enabled} onChange={(v) => set("buy_enabled", v)} /></div>
        <div className="row" style={{ marginTop: 12 }}><div><div className="title">Allow selling coins</div><div className="sub">Users turn coins into USDT</div></div><Toggle on={s.sell_enabled} onChange={(v) => set("sell_enabled", v)} /></div>
        <div className="grid3">
          <div><label>Coins per 1 TFUEL</label><input inputMode="numeric" value={s.coins_per_tfuel} onChange={(e) => set("coins_per_tfuel", e.target.value)} /></div>
          <div><label>Fee per trade (%)</label><input inputMode="decimal" value={s.trade_fee_pct} onChange={(e) => set("trade_fee_pct", e.target.value)} /></div>
          <div><label>Price override (USDT, 0 = live)</label><input inputMode="decimal" value={s.price_override} onChange={(e) => set("price_override", e.target.value)} /></div>
          <div><label>Min trade (USDT)</label><input inputMode="decimal" value={s.min_trade_usdt} onChange={(e) => set("min_trade_usdt", e.target.value)} /></div>
          <div><label>Max trade (USDT)</label><input inputMode="decimal" value={s.max_trade_usdt} onChange={(e) => set("max_trade_usdt", e.target.value)} /></div>
          <div><label>Daily limit per user (USDT, 0 = none)</label><input inputMode="decimal" value={s.daily_trade_limit_usdt} onChange={(e) => set("daily_trade_limit_usdt", e.target.value)} /></div>
        </div>
        <div className="xs muted" style={{ marginTop: 8 }}>Value of 1 coin = price ÷ coins per TFUEL. Keep the fee above zero so quick buy-then-sell cycles can&apos;t profit from small price moves.</div>
      </div>

      <div className="card">
        <div className="row"><div><div className="title">USDT deposits</div><div className="sub">Users send USDT to your address, then submit the TxID for your approval</div></div><Toggle on={s.deposit_enabled} onChange={(v) => set("deposit_enabled", v)} /></div>
        {s.deposit_networks.map((n: any, i: number) => (
          <div key={i} className="card" style={{ background: "var(--soft)", boxShadow: "none", marginTop: 12, marginBottom: 0 }}>
            <div className="grid2">
              <div><label style={{ marginTop: 0 }}>Network name</label><input value={n.name} placeholder="USDT TRC20" onChange={(e) => setNet("deposit_networks", i, { name: e.target.value })} /></div>
              <div><label style={{ marginTop: 0 }}>Minimum (USDT)</label><input inputMode="decimal" value={n.min} onChange={(e) => setNet("deposit_networks", i, { min: e.target.value })} /></div>
            </div>
            <label>Your receiving address</label>
            <input value={n.address} onChange={(e) => setNet("deposit_networks", i, { address: e.target.value })} />
            <label>Note for users (optional)</label>
            <input value={n.note || ""} onChange={(e) => setNet("deposit_networks", i, { note: e.target.value })} />
            <label>Binance network code (for auto-approve — leave empty for manual)</label>
            <input value={n.binance_network || ""} placeholder="TRX = TRC20 · BSC = BEP20 · ETH = ERC20" onChange={(e) => setNet("deposit_networks", i, { binance_network: e.target.value.toUpperCase() })} />
            <button className="btn sec sm" style={{ marginTop: 10 }} onClick={() => set("deposit_networks", s.deposit_networks.filter((_: any, j: number) => j !== i))}><Icon name="trash" size={14} /> Remove</button>
          </div>
        ))}
        <button className="btn sec sm" style={{ marginTop: 12 }} onClick={() => set("deposit_networks", [...s.deposit_networks, { name: "", address: "", min: 5, note: "" }])}><Icon name="plus" size={14} /> Add network</button>
      </div>

      <BinanceCard s={s} set={set} call={call} />
      <MoreDeposits s={s} set={set} call={call} />

      <div className="card">
        <div className="row"><div><div className="title">USDT withdrawals</div><div className="sub">You send payouts manually. No wallet keys are ever stored in the app.</div></div><Toggle on={s.payout_enabled} onChange={(v) => set("payout_enabled", v)} /></div>
        {s.payout_networks.map((n: any, i: number) => (
          <div key={i} className="card" style={{ background: "var(--soft)", boxShadow: "none", marginTop: 12, marginBottom: 0 }}>
            <div className="grid3">
              <div><label style={{ marginTop: 0 }}>Network name</label><input value={n.name} placeholder="USDT TRC20" onChange={(e) => setNet("payout_networks", i, { name: e.target.value })} /></div>
              <div><label style={{ marginTop: 0 }}>Minimum (USDT)</label><input inputMode="decimal" value={n.min} onChange={(e) => setNet("payout_networks", i, { min: e.target.value })} /></div>
              <div><label style={{ marginTop: 0 }}>Fee (USDT)</label><input inputMode="decimal" value={n.fee} onChange={(e) => setNet("payout_networks", i, { fee: e.target.value })} /></div>
            </div>
            <label>Address check (pattern)</label>
            <input value={n.regex || ""} placeholder="Optional" onChange={(e) => setNet("payout_networks", i, { regex: e.target.value })} />
            <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
              {Object.entries(PRESETS).map(([k, v]) => <button key={k} className="btn sec sm" onClick={() => setNet("payout_networks", i, { regex: v })}>Use {k}</button>)}
              <button className="btn sec sm" onClick={() => set("payout_networks", s.payout_networks.filter((_: any, j: number) => j !== i))}><Icon name="trash" size={14} /> Remove</button>
            </div>
          </div>
        ))}
        <button className="btn sec sm" style={{ marginTop: 12 }} onClick={() => set("payout_networks", [...s.payout_networks, { name: "", min: 5, fee: 1, regex: "" }])}><Icon name="plus" size={14} /> Add network</button>
      </div>
    </>
  );
}

/* ---------------- Rewards & Plans ---------------- */
function RewardsPage({ call }: { call: Call }) {
  const tf = useTf();
  const [s, setS] = useState<any>(null);
  const [plans, setPlans] = useState<{ boosts: any[]; stakes: any[] }>({ boosts: [], stakes: [] });
  const [eb, setEb] = useState<any | null>(null);
  const [es, setEs] = useState<any | null>(null);
  const loadPlans = useCallback(async () => {
    const d: any = await call({ action: "growthPlans" });
    if (d) setPlans({ boosts: d.boosts, stakes: d.stakes });
  }, [call]);
  useEffect(() => {
    call({ action: "getSettings" }).then((d: any) => d && setS(d.settings));
    loadPlans();
  }, [call, loadPlans]);
  if (!s) return <div className="empty">Loading…</div>;
  const set = (k: string, v: any) => setS({ ...s, [k]: v });
  const save = async () => {
    const keys = ["daily_enabled", "daily_rewards", "referral_enabled", "referrer_bonus", "invitee_bonus", "referral_max", "referral_commission_pct", "referral_link", "mine_cap_hours"];
    const body: any = {};
    keys.forEach((k) => (body[k] = s[k]));
    const d: any = await call({ action: "saveSettings", settings: body }, "Saved");
    if (d) setS(d.settings);
  };
  const blank = { name: "", price: 10000, duration_days: 30, tap_bonus: 1, energy_bonus: 0, regen_bonus: 0, mine_per_hour: 0, is_active: true };
  const blankS = { name: "", days: 7, reward_pct: 20, min: 1000, max: 100000, pool_cap: 0, is_active: true };
  return (
    <>
      <Head2 title="Rewards & Plans" sub="Daily reward, referrals, boosts with auto-mining, and staking. Amounts are in coins (shown with TFUEL equivalent).">
        <button className="btn" onClick={save}>Save settings</button>
      </Head2>

      <div className="card">
        <div className="row"><div><div className="title">Daily reward</div><div className="sub">Claim once per UTC day. A missed day resets the streak to day 1.</div></div><Toggle on={s.daily_enabled} onChange={(v) => set("daily_enabled", v)} /></div>
        <label>Reward per streak day (coins)</label>
        <div className="grid3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))" }}>
          {s.daily_rewards.map((r: number, i: number) => (
            <div key={i}>
              <input inputMode="numeric" value={r} onChange={(e) => set("daily_rewards", s.daily_rewards.map((x: number, j: number) => (j === i ? Number(e.target.value.replace(/\D/g, "")) : x)))} />
              <div className="xs muted" style={{ marginTop: 3 }}>Day {i + 1} · {tf(r)}</div>
            </div>
          ))}
        </div>
        <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
          <button className="btn sec sm" disabled={s.daily_rewards.length >= 31} onClick={() => set("daily_rewards", [...s.daily_rewards, s.daily_rewards[s.daily_rewards.length - 1] || 100])}><Icon name="plus" size={14} /> Add day</button>
          <button className="btn sec sm" disabled={s.daily_rewards.length <= 1} onClick={() => set("daily_rewards", s.daily_rewards.slice(0, -1))}>Remove last</button>
        </div>
      </div>

      <div className="card">
        <div className="row"><div><div className="title">Referrals</div><div className="sub">Bonus is paid after the invited friend completes their first task, so fake joins earn nothing.</div></div><Toggle on={s.referral_enabled} onChange={(v) => set("referral_enabled", v)} /></div>
        <div className="grid3">
          <div><label>Referrer bonus (coins)</label><input inputMode="numeric" value={s.referrer_bonus} onChange={(e) => set("referrer_bonus", e.target.value)} /><Hint coins={s.referrer_bonus} /></div>
          <div><label>Friend bonus (coins)</label><input inputMode="numeric" value={s.invitee_bonus} onChange={(e) => set("invitee_bonus", e.target.value)} /><Hint coins={s.invitee_bonus} /></div>
          <div><label>Lifetime commission on friends' earnings (%)</label><input inputMode="decimal" value={s.referral_commission_pct} onChange={(e) => set("referral_commission_pct", e.target.value)} /></div>
          <div><label>Max rewarded friends / user</label><input inputMode="numeric" value={s.referral_max} onChange={(e) => set("referral_max", e.target.value)} /></div>
        </div>
        <label>Mini App link (https://t.me/yourbot/appname)</label>
        <input value={s.referral_link} onChange={(e) => set("referral_link", e.target.value)} placeholder="https://t.me/yourbot/app" />
        <div className="xs muted" style={{ marginTop: 4 }}>The invite link becomes this address + ?startapp=ref_USERID. Set the Mini App in BotFather first.</div>
      </div>

      <div className="card">
        <div className="title">Auto-mining</div>
        <div className="sub">Boosts with “mining per hour” earn while the user is away. Mined coins stop piling up after this many hours until they collect.</div>
        <div style={{ maxWidth: 220 }}><label>Storage cap (hours)</label><input inputMode="decimal" value={s.mine_cap_hours} onChange={(e) => set("mine_cap_hours", e.target.value)} /></div>
      </div>

      <div className="row" style={{ margin: "18px 0 10px" }}>
        <h2 style={{ margin: 0 }}>Boost plans</h2>
        <button className="btn sm" onClick={() => setEb({ ...blank })}><Icon name="plus" size={15} /> New boost</button>
      </div>
      <div className="card scroll-x" style={{ padding: 4 }}>
        <table className="tbl">
          <thead><tr><th>Plan</th><th>Price</th><th>Per tap</th><th>Energy</th><th>Refill</th><th>Mining / hr</th><th>Duration</th><th>Payback</th><th /></tr></thead>
          <tbody>
            {plans.boosts.map((p) => (
              <tr key={p.id}>
                <td><div className="b">{p.name}</div>{!p.is_active && <span className="tag">Hidden</span>}</td>
                <td className="num">{tf(p.price)}</td>
                <td className="num">+{tf(p.tap_bonus)}</td>
                <td className="num">+{p.energy_bonus}</td>
                <td className="num">+{p.regen_bonus}</td>
                <td className="num">{tf(p.mine_per_hour)}</td>
                <td>{p.duration_days ? `${p.duration_days}d` : "∞"}</td>
                <td className="xs">{p.mine_per_hour ? `${(p.price / p.mine_per_hour / 24).toFixed(1)} days (mining only)` : "—"}</td>
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  <button className="btn sec sm" onClick={() => setEb({ ...p })}><Icon name="edit" size={14} /></button>{" "}
                  <button className="btn sec sm" onClick={async () => { if (confirm(`Delete "${p.name}"? Active boosts keep working.`) && (await call({ action: "deleteBoost", id: p.id }, "Deleted"))) loadPlans(); }}><Icon name="trash" size={14} /></button>
                </td>
              </tr>
            ))}
            {plans.boosts.length === 0 && <tr><td colSpan={9} className="empty">No boost plans yet</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ margin: "18px 0 10px" }}>
        <h2 style={{ margin: 0 }}>Staking plans</h2>
        <button className="btn sm" onClick={() => setEs({ ...blankS })}><Icon name="plus" size={15} /> New staking plan</button>
      </div>
      <div className="card scroll-x" style={{ padding: 4 }}>
        <table className="tbl">
          <thead><tr><th>Plan</th><th>Days</th><th>Reward</th><th>Min – Max</th><th>Pool used / cap</th><th /></tr></thead>
          <tbody>
            {plans.stakes.map((p) => (
              <tr key={p.id}>
                <td><div className="b">{p.name}</div>{!p.is_active && <span className="tag">Hidden</span>}</td>
                <td>{p.days}</td>
                <td className="num">+{p.reward_pct}%</td>
                <td className="num">{tf(p.min)} – {tf(p.max)}</td>
                <td className="num">{tf(p.pool_used)} / {p.pool_cap ? tf(p.pool_cap) : "no cap"}</td>
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  <button className="btn sec sm" onClick={() => setEs({ ...p })}><Icon name="edit" size={14} /></button>{" "}
                  <button className="btn sec sm" onClick={async () => { if (confirm(`Delete "${p.name}"? Running stakes still pay out.`) && (await call({ action: "deleteStakePlan", id: p.id }, "Deleted"))) loadPlans(); }}><Icon name="trash" size={14} /></button>
                </td>
              </tr>
            ))}
            {plans.stakes.length === 0 && <tr><td colSpan={6} className="empty">No staking plans yet</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="banner info"><Icon name="info" size={18} /><span>Staking and boosts use in-app TFUEL only. Staking rewards are newly created TFUEL that users can later sell for USDT, so set the percentage and the pool cap with your budget in mind.</span></div>

      {eb && (
        <Modal onClose={() => setEb(null)}>
          <h2 style={{ marginTop: 0 }}>{eb.id ? "Edit boost" : "New boost"}</h2>
          <label>Name</label>
          <input value={eb.name} onChange={(e) => setEb({ ...eb, name: e.target.value })} />
          <div className="grid2">
            <div><label>Price (coins)</label><input inputMode="numeric" value={eb.price} onChange={(e) => setEb({ ...eb, price: e.target.value })} /><Hint coins={eb.price} /></div>
            <div><label>Duration (days, 0 = permanent)</label><input inputMode="numeric" value={eb.duration_days} onChange={(e) => setEb({ ...eb, duration_days: e.target.value })} /></div>
            <div><label>Extra coins per tap</label><input inputMode="numeric" value={eb.tap_bonus} onChange={(e) => setEb({ ...eb, tap_bonus: e.target.value })} /><Hint coins={eb.tap_bonus} /></div>
            <div><label>Extra max energy</label><input inputMode="numeric" value={eb.energy_bonus} onChange={(e) => setEb({ ...eb, energy_bonus: e.target.value })} /></div>
            <div><label>Extra energy refill / sec</label><input inputMode="decimal" value={eb.regen_bonus} onChange={(e) => setEb({ ...eb, regen_bonus: e.target.value })} /></div>
            <div><label>Auto-mining coins / hour</label><input inputMode="numeric" value={eb.mine_per_hour} onChange={(e) => setEb({ ...eb, mine_per_hour: e.target.value })} /><Hint coins={eb.mine_per_hour} /></div>
          </div>
          <div className="row" style={{ marginTop: 12 }}><span className="sm">Visible to users</span><Toggle on={eb.is_active !== false} onChange={(v) => setEb({ ...eb, is_active: v })} /></div>
          <div className="toolbar" style={{ marginTop: 14, justifyContent: "flex-end" }}>
            <button className="btn sec" onClick={() => setEb(null)}>Cancel</button>
            <button className="btn" onClick={async () => { if (await call({ action: "saveBoost", ...eb }, "Saved")) { setEb(null); loadPlans(); } }}>Save</button>
          </div>
        </Modal>
      )}
      {es && (
        <Modal onClose={() => setEs(null)}>
          <h2 style={{ marginTop: 0 }}>{es.id ? "Edit staking plan" : "New staking plan"}</h2>
          <label>Name</label>
          <input value={es.name} onChange={(e) => setEs({ ...es, name: e.target.value })} placeholder="7-day stake" />
          <div className="grid2">
            <div><label>Lock period (days)</label><input inputMode="numeric" value={es.days} onChange={(e) => setEs({ ...es, days: e.target.value })} /></div>
            <div><label>Reward at the end (%)</label><input inputMode="decimal" value={es.reward_pct} onChange={(e) => setEs({ ...es, reward_pct: e.target.value })} /></div>
            <div><label>Min stake (coins)</label><input inputMode="numeric" value={es.min} onChange={(e) => setEs({ ...es, min: e.target.value })} /><Hint coins={es.min} /></div>
            <div><label>Max stake (coins)</label><input inputMode="numeric" value={es.max} onChange={(e) => setEs({ ...es, max: e.target.value })} /><Hint coins={es.max} /></div>
            <div><label>Pool cap (coins, 0 = none)</label><input inputMode="numeric" value={es.pool_cap} onChange={(e) => setEs({ ...es, pool_cap: e.target.value })} /><Hint coins={es.pool_cap} /></div>
          </div>
          <div className="banner info" style={{ marginBottom: 0 }}><Icon name="info" size={18} /><span>Example: stake {tf(es.min)} TFUEL for {es.days} days → get {tf(Number(es.min) * (1 + Number(es.reward_pct) / 100))} TFUEL back.</span></div>
          <div className="row" style={{ marginTop: 12 }}><span className="sm">Visible to users</span><Toggle on={es.is_active !== false} onChange={(v) => setEs({ ...es, is_active: v })} /></div>
          <div className="toolbar" style={{ marginTop: 14, justifyContent: "flex-end" }}>
            <button className="btn sec" onClick={() => setEs(null)}>Cancel</button>
            <button className="btn" onClick={async () => { if (await call({ action: "saveStakePlan", ...es }, "Saved")) { setEs(null); loadPlans(); } }}>Save</button>
          </div>
        </Modal>
      )}
    </>
  );
}
