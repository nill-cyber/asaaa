import { useCallback, useEffect, useRef, useState } from "react";
import { api, errText, openLink, openTgLink, tg } from "@/lib/client";

interface Me {
  user: { id: string; name?: string; balance: number; energy: number; maxEnergy: number };
  tasks: Task[];
  run: { step_done: number; total: number; status: string } | null;
  sitesAvailable: number;
  withdrawals: { id: string; amount: number; method: string; status: string; created_at: number }[];
  cfg: { minWithdraw: number; methods: string[]; coinsPerUnit: number; unitLabel: string };
}
interface Task {
  id: string;
  type: "telegram_join" | "timer_visit";
  title: string;
  url?: string;
  reward: number;
  min_wait_seconds?: number;
  channel_id?: string;
  done: boolean;
}
type Say = (t: string, ok?: boolean) => void;
type Tab = "tap" | "earn" | "tasks" | "profile";

const MAX_TAPS_PER_FLUSH = 14; // server সীমা 15/sec-এর নিচে
const REGEN_PER_SEC = 3; // শুধু UI-র জন্য অনুমান; আসল মান server-এ

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>("tap");
  const [toast, setToast] = useState<{ t: string; ok: boolean } | null>(null);
  const [floats, setFloats] = useState<{ id: number; x: number }[]>([]);
  const [noTg, setNoTg] = useState(false);
  const [logoOk, setLogoOk] = useState(true);

  const balance = useRef(0);
  const energy = useRef(0);
  const pending = useRef(0);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const say = useCallback<Say>((t, ok = false) => {
    setToast({ t, ok });
    setTimeout(() => setToast(null), 2600);
  }, []);

  // server-এর মান আনে; এখনো না-পাঠানো tap নষ্ট করে না
  const load = useCallback(async () => {
    try {
      const d = await api<Me>("me");
      setMe(d);
      balance.current = d.user.balance + pending.current;
      energy.current = Math.max(0, d.user.energy - pending.current);
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
    load();
    // আর্টিকেল সাইট থেকে অ্যাপে ফিরলে নতুন অবস্থা আনি
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  // প্রতি সেকেন্ডে: জমানো tap পাঠানো + UI-তে energy ফেরত দেখানো
  useEffect(() => {
    const iv = setInterval(async () => {
      if (me && energy.current < me.user.maxEnergy) {
        energy.current = Math.min(me.user.maxEnergy, energy.current + REGEN_PER_SEC);
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
          load(); // server-এর সত্যিকারের মানে ফিরে যাওয়া
        }
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [me, load, say]);

  const onTap = (e: React.PointerEvent) => {
    if (!me || energy.current < 1 || pending.current >= MAX_TAPS_PER_FLUSH) return;
    pending.current += 1;
    energy.current -= 1;
    balance.current += 1;
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

  if (noTg) return <div className="app center">এই অ্যাপটি Telegram-এর ভেতর থেকে খুলুন।</div>;
  if (!me) return <div className="app center">লোড হচ্ছে…</div>;

  const pct = Math.max(0, Math.min(100, (energy.current / me.user.maxEnergy) * 100));

  return (
    <div className="app">
      {toast && <div className={`toast ${toast.ok ? "ok" : "err"}`}>{toast.t}</div>}

      <div className="balance">
        <div className="lbl">আপনার ব্যালেন্স</div>
        <div className="num">🪙 {Math.floor(balance.current).toLocaleString()}</div>
      </div>

      {tab === "tap" && (
        <>
          <div className="coin-wrap">
            <button className="coin" onPointerDown={onTap} disabled={energy.current < 1} aria-label="tap">
              {logoOk ? (
                // public/logo.png রাখলে সেটাই কয়েনে দেখাবে; না থাকলে 🪙
                <img src="/logo.png" alt="" className="coin-img" draggable={false} onError={() => setLogoOk(false)} />
              ) : (
                "🪙"
              )}
            </button>
            {floats.map((f) => (
              <span key={f.id} className="float" style={{ left: f.x, top: 60 }}>
                +1
              </span>
            ))}
          </div>
          <div className="energy">
            <div className="t">
              <span>⚡ Energy</span>
              <span>
                {Math.max(0, Math.floor(energy.current))} / {me.user.maxEnergy}
              </span>
            </div>
            <div className="bar">
              <div style={{ width: `${pct}%` }} />
            </div>
          </div>
        </>
      )}

      {tab === "earn" && <Earn me={me} say={say} reload={load} />}
      {tab === "tasks" && <Tasks me={me} say={say} reload={load} />}
      {tab === "profile" && <Profile me={me} balance={Math.floor(balance.current)} say={say} reload={load} />}

      <div className="nav">
        {(
          [
            ["tap", "👆 Tap"],
            ["earn", "📰 Earn"],
            ["tasks", "📋 Tasks"],
            ["profile", "👤 Profile"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => go(k)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 📰 Article Site: চেইন শুরু + কোড বসিয়ে reward নেওয়া */
function Earn({ me, say, reload }: { me: Me; say: Say; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");

  const start = async () => {
    setBusy("start");
    try {
      const r = await api<{ url: string; step: number; total: number; resumed: boolean }>("start-chain");
      say(r.resumed ? "আগের জায়গা থেকে চালু হচ্ছে" : `আর্টিকেল ১/${r.total} খুলছে`, true);
      openLink(r.url);
      reload();
    } catch (e: any) {
      if (e.message === "no_site_available" && e.data?.retry_at) {
        say(`পরের সাইট খালি হবে ${Math.max(1, Math.ceil((e.data.retry_at - Date.now()) / 60000))} মিনিট পর`);
      } else say(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const claim = async () => {
    setBusy("claim");
    try {
      const r = await api<{ reward: number }>("claim-reward", { inputCode: code });
      setCode("");
      setMsg(`🎉 +${r.reward.toLocaleString()} coin পেয়েছেন!`);
      say(`+${r.reward.toLocaleString()} 🪙`, true);
      reload();
    } catch (e: any) {
      let t = errText(e);
      if (e.message === "wrong_code" && e.data?.attempts_left !== undefined) t += ` (আর ${e.data.attempts_left} বার চেষ্টা বাকি)`;
      setMsg(t);
      say(t);
      if (e.message === "locked") reload();
    } finally {
      setBusy(null);
    }
  };

  const run = me.run;
  const status = run
    ? `চলমান: ${run.step_done}/${run.total} আর্টিকেল শেষ` +
      (run.status === "code_issued" ? " — কোড পেয়েছেন, নিচে বসান" : "। বাটন চাপলে যেখানে ছিলেন সেখান থেকে চলবে।")
    : me.sitesAvailable > 0
    ? `${me.sitesAvailable}টা সাইট এখন খালি`
    : "এখন কোনো সাইট খালি নেই, একটু পরে আসুন";

  return (
    <>
      <h2>📰 Article Site</h2>
      <div className="card">
        <div className="sub" style={{ marginBottom: 10 }}>
          বাটন চাপলে একটা সাইট খুলবে। আর্টিকেলগুলো <b>ক্রমে</b> পড়ুন আর প্রতিবার "পরের আর্টিকেল" চাপুন। শেষ আর্টিকেলে ৬ ডিজিটের কোড পাবেন।
          সরাসরি শেষ আর্টিকেলে গেলে কোড মিলবে না।
        </div>
        <button className="btn" style={{ width: "100%" }} disabled={busy === "start"} onClick={start}>
          📰 Article Site
        </button>
        <div className="sub" style={{ marginTop: 8 }}>{status}</div>
      </div>

      <div className="card">
        <div className="title">কোড বসান</div>
        <div className="code-row">
          <input
            inputMode="numeric"
            maxLength={6}
            placeholder="৬ ডিজিটের কোড"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
          <button className="btn" disabled={code.length !== 6 || busy === "claim"} onClick={claim}>
            Claim
          </button>
        </div>
        {msg && <div className="sub" style={{ marginTop: 8 }}>{msg}</div>}
      </div>
    </>
  );
}

/** 📋 Telegram join ও টাইমার টাস্ক */
function Tasks({ me, say, reload }: { me: Me; say: Say; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [started, setStarted] = useState<Record<string, number>>({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 500);
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
      say(`+${r.reward} 🪙`, true);
      reload();
    });

  const finish = (t: Task) =>
    run(t.id, async () => {
      const r = await api<{ reward: number }>("complete-task", { taskId: t.id });
      say(`+${r.reward} 🪙`, true);
      reload();
    });

  return (
    <>
      <h2>Tasks</h2>
      {me.tasks.length === 0 && <div className="sub">এখন কোনো টাস্ক নেই।</div>}
      {me.tasks.map((t) => {
        const st = started[t.id];
        const wait = (t.min_wait_seconds || 10) * 1000;
        const left = st ? Math.max(0, Math.ceil((st + wait - now) / 1000)) : 0;
        return (
          <div className="card" key={t.id}>
            <div className="row">
              <div>
                <div className="title">{t.title}</div>
                <div className="sub">+{t.reward.toLocaleString()} 🪙</div>
              </div>
              {t.done ? (
                <span className="done">✓ সম্পন্ন</span>
              ) : t.type === "telegram_join" ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn sec" disabled={busy === t.id} onClick={() => openTask(t)}>
                    Join
                  </button>
                  <button className="btn" disabled={busy === t.id} onClick={() => verify(t)}>
                    Check
                  </button>
                </div>
              ) : !st ? (
                <button className="btn" disabled={busy === t.id} onClick={() => openTask(t)}>
                  Open
                </button>
              ) : (
                <button className="btn" disabled={left > 0 || busy === t.id} onClick={() => finish(t)}>
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

/** 👤 প্রোফাইল: ব্যালেন্স + withdraw */
function Profile({ me, balance, say, reload }: { me: Me; balance: number; say: Say; reload: () => void }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const { minWithdraw, methods, coinsPerUnit, unitLabel } = me.cfg;

  const submit = async () => {
    setBusy(true);
    try {
      await api("withdraw", { amount: parseInt(amount, 10) || 0, method, account });
      setMsg("✅ অনুরোধ পাঠানো হয়েছে। অ্যাডমিন যাচাই করে পাঠিয়ে দেবেন।");
      setAmount("");
      reload();
    } catch (e: any) {
      let t = errText(e);
      if (e.message === "below_minimum" && e.data?.min) t += ` (${Number(e.data.min).toLocaleString()} coin)`;
      setMsg(t);
      say(t);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>👤 {me.user.name || "Profile"}</h2>
      <div className="card" style={{ textAlign: "center" }}>
        <div className="big">{balance.toLocaleString()} coin</div>
        <div className="sub">
          ≈ {(balance / coinsPerUnit).toFixed(2)} {unitLabel}
        </div>
      </div>

      <div className="card">
        <div className="title">💸 Withdraw</div>
        <div className="sub" style={{ marginBottom: 6 }}>
          ন্যূনতম {minWithdraw.toLocaleString()} coin (≈ {(minWithdraw / coinsPerUnit).toFixed(2)} {unitLabel})
        </div>
        <input inputMode="numeric" placeholder="কত coin" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
        <div style={{ height: 8 }} />
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">পদ্ধতি বেছে নিন</option>
          {methods.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <div style={{ height: 8 }} />
        <input placeholder="অ্যাকাউন্ট নম্বর / ঠিকানা" maxLength={100} value={account} onChange={(e) => setAccount(e.target.value)} />
        <div style={{ marginTop: 12 }}>
          <button className="btn" style={{ width: "100%" }} disabled={busy} onClick={submit}>
            Withdraw অনুরোধ পাঠান
          </button>
        </div>
        {msg && <div className="sub" style={{ marginTop: 8 }}>{msg}</div>}
      </div>

      <div className="card">
        <div className="title">ইতিহাস</div>
        {me.withdrawals.length === 0 && <div className="sub">কিছু নেই</div>}
        {me.withdrawals.map((w) => (
          <div className="hist" key={w.id}>
            <span>
              {w.amount.toLocaleString()} · {w.method}
            </span>
            <span className={`st-${w.status}`}>{w.status}</span>
          </div>
        ))}
      </div>
    </>
  );
}
