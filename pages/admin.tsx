import { useCallback, useEffect, useState } from "react";
import { api, errText, tg } from "@/lib/client";

interface SiteRow {
  id: string;
  name: string;
  urls: string[];
  reward: number;
  cooldown_minutes: number;
  dwell_seconds: number;
  is_active: boolean;
}
interface TaskRow {
  id: string;
  type: string;
  title: string;
  url?: string;
  channel_id?: string;
  reward: number;
  min_wait_seconds?: number;
}
interface WdRow {
  id: string;
  uid: string;
  name: string;
  amount: number;
  method: string;
  account: string;
  status: string;
  created_at: number;
  note?: string;
}
type Act = (body: Record<string, any>, after?: (d: any) => void) => Promise<void>;

/**
 * /admin: Telegram Mini App-এর ভেতর থেকেই খুলতে হবে (initData দিয়ে অ্যাডমিন চেনা হয়)।
 * অ্যাডমিন চেনার তালিকা: env ADMIN_TELEGRAM_IDS
 */
export default function Admin() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [wds, setWds] = useState<WdRow[]>([]);
  const [tab, setTab] = useState<"sites" | "wd" | "tasks">("sites");
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);
  const [edit, setEdit] = useState<SiteRow | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [pw, setPw] = useState("");
  const [loginErr, setLoginErr] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ sites: SiteRow[]; tasks: TaskRow[]; withdrawals: WdRow[] }>("admin", { action: "list" });
      setSites(d.sites);
      setTasks(d.tasks);
      setWds(d.withdrawals);
      setErr("");
    } catch (e: any) {
      setErr(e.message);
      // ব্রাউজারে (Telegram-এর বাইরে) খুললে পাসওয়ার্ড চাই
      if (!tg()?.initData) setNeedLogin(true);
    } finally {
      setReady(true);
    }
  }, []);

  const login = async () => {
    setLoginErr("");
    try {
      const d = await api<{ token: string }>("admin-login", { password: pw });
      sessionStorage.setItem("adm", d.token);
      setNeedLogin(false);
      setPw("");
      setReady(false);
      await load();
    } catch (e: any) {
      setLoginErr(e.message);
    }
  };

  useEffect(() => {
    tg()?.ready();
    tg()?.expand();
    load();
  }, [load]);

  const act: Act = async (body, after) => {
    try {
      const d = await api("admin", body);
      after?.(d);
      await load();
    } catch (e: any) {
      alert(errText(e));
    }
  };

  if (!ready) return <div className="app center">লোড হচ্ছে…</div>;
  if (needLogin)
    return (
      <div className="app">
        <h2>Admin লগইন</h2>
        <div className="card">
          <label>পাসওয়ার্ড</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} autoFocus />
          {loginErr && <div className="sub" style={{ color: "var(--err)", marginTop: 8 }}>{loginErr}</div>}
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={login}>
              ঢুকুন
            </button>
          </div>
        </div>
      </div>
    );
  if (err) return <div className="app center">⛔ {err}<div className="sub">Telegram-এর ভেতর থেকে, অ্যাডমিন অ্যাকাউন্টে খুলুন।</div></div>;

  const pending = wds.filter((w) => w.status === "pending").length;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="app" style={{ paddingBottom: 40 }}>
      <h2>Admin</h2>
      <div className="tabs">
        <button className={tab === "sites" ? "on" : ""} onClick={() => setTab("sites")}>
          Article সাইট
        </button>
        <button className={tab === "wd" ? "on" : ""} onClick={() => setTab("wd")}>
          Withdraw{pending ? ` (${pending})` : ""}
        </button>
        <button className={tab === "tasks" ? "on" : ""} onClick={() => setTab("tasks")}>
          Tasks
        </button>
      </div>

      {tab === "sites" && (
        <>
          <div className="card">
            <div className="title">প্রতিটা আর্টিকেল পেজে বসানোর কোড</div>
            <div className="sub">Blogger: Theme → Edit HTML → &lt;/body&gt;-এর আগে একবার। সব সাইটে একই কোড।</div>
            <pre>{`<script src="${origin}/chain.js" async></script>`}</pre>
          </div>

          <h2>আপনার সাইটগুলো ({sites.length})</h2>
          {sites.length === 0 && <div className="sub">এখনো কোনো সাইট নেই।</div>}
          {sites.map((s) => (
            <div className="card" key={s.id}>
              <div className="title">
                {s.name} {s.is_active ? "🟢" : "🔴"}
              </div>
              <div className="sub">
                {s.urls.length}টা আর্টিকেল · +{s.reward.toLocaleString()} · cooldown {s.cooldown_minutes}m · {s.dwell_seconds}s/আর্টিকেল
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <button className="btn sec" onClick={() => setEdit(s)}>
                  এডিট
                </button>
                <button className="btn sec" onClick={() => act({ action: "toggleSite", siteId: s.id, active: !s.is_active })}>
                  {s.is_active ? "বন্ধ" : "চালু"}
                </button>
                <button className="btn danger" onClick={() => confirm("মুছে ফেলবেন?") && act({ action: "deleteSite", siteId: s.id })}>
                  মুছুন
                </button>
              </div>
            </div>
          ))}
          <SiteForm key={edit?.id || "new"} edit={edit} act={act} onDone={() => setEdit(null)} />
        </>
      )}

      {tab === "wd" && (
        <>
          <h2>Withdraw অনুরোধ</h2>
          {wds.length === 0 && <div className="sub">এখনো কোনো অনুরোধ নেই।</div>}
          {wds.map((w) => (
            <WdCard key={w.id} w={w} act={act} />
          ))}
        </>
      )}

      {tab === "tasks" && (
        <>
          <h2>Tasks</h2>
          {tasks.map((t) => (
            <div className="card" key={t.id}>
              <div className="row">
                <div>
                  <div className="title">{t.title}</div>
                  <div className="sub">
                    {t.type} · +{t.reward} · {t.channel_id || t.url}
                  </div>
                </div>
                <button className="btn danger" onClick={() => confirm("মুছবেন?") && act({ action: "deleteTask", taskId: t.id })}>
                  ✕
                </button>
              </div>
            </div>
          ))}
          <AddTask act={act} />
        </>
      )}
    </div>
  );
}

function SiteForm({ edit, act, onDone }: { edit: SiteRow | null; act: Act; onDone: () => void }) {
  const [f, setF] = useState({
    name: edit?.name || "",
    urls: edit ? edit.urls.join("\n") : "",
    reward: String(edit?.reward ?? 5000),
    cooldown_minutes: String(edit?.cooldown_minutes ?? 60),
    dwell_seconds: String(edit?.dwell_seconds ?? 15),
    is_active: edit?.is_active ?? true,
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="card">
      <div className="title">{edit ? "সাইট এডিট" : "+ নতুন Article সাইট"}</div>
      <label>সাইটের নাম (নিজের চেনার জন্য)</label>
      <input value={f.name} onChange={set("name")} />
      <label>আর্টিকেল URL — প্রতি লাইনে একটা, ১ম থেকে শেষ ক্রমে (https, একই ডোমেইন)</label>
      <textarea
        rows={6}
        value={f.urls}
        onChange={set("urls")}
        placeholder={"https://myblog.blogspot.com/2026/10/article-1.html\nhttps://myblog.blogspot.com/2026/10/article-2.html"}
      />
      <div className="grid2">
        <div>
          <label>Reward (coin)</label>
          <input inputMode="numeric" value={f.reward} onChange={set("reward")} />
        </div>
        <div>
          <label>Cooldown (মিনিট)</label>
          <input inputMode="numeric" value={f.cooldown_minutes} onChange={set("cooldown_minutes")} />
        </div>
      </div>
      <label>প্রতি আর্টিকেলে অপেক্ষা (সেকেন্ড, কমপক্ষে ৫)</label>
      <input inputMode="numeric" value={f.dwell_seconds} onChange={set("dwell_seconds")} />
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" style={{ width: "auto" }} checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />
        চালু
      </label>
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button
          className="btn"
          onClick={() =>
            act({ action: "saveSite", siteId: edit?.id, ...f }, () => {
              alert("সংরক্ষিত হয়েছে");
              onDone();
            })
          }
        >
          {edit ? "আপডেট" : "সাইট যোগ করুন"}
        </button>
        {edit && (
          <button className="btn sec" onClick={onDone}>
            বাতিল
          </button>
        )}
      </div>
    </div>
  );
}

function WdCard({ w, act }: { w: WdRow; act: Act }) {
  const [note, setNote] = useState("");
  return (
    <div className="card">
      <div className="title">
        {w.amount.toLocaleString()} coin <span className={`tag st-${w.status}`}>{w.status}</span>
      </div>
      <div className="sub">
        {w.method} · <b>{w.account}</b>
      </div>
      <div className="sub">
        {w.name} ({w.uid}) · {new Date(w.created_at).toLocaleString()}
      </div>
      {w.note && <div className="sub">নোট: {w.note}</div>}
      {w.status === "pending" && (
        <>
          <input style={{ marginTop: 8 }} placeholder="নোট (ঐচ্ছিক)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={() => act({ action: "payWithdrawal", id: w.id, note })}>
              টাকা পাঠিয়েছি ✔
            </button>
            <button
              className="btn danger"
              onClick={() => confirm("বাতিল করে coin ফেরত দেবেন?") && act({ action: "rejectWithdrawal", id: w.id, note })}
            >
              বাতিল + ফেরত
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AddTask({ act }: { act: Act }) {
  const [f, setF] = useState({ type: "telegram_join", title: "", reward: "5000", channel_id: "", url: "", min_wait_seconds: "10" });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="card">
      <div className="title">+ নতুন টাস্ক</div>
      <label>ধরন</label>
      <select value={f.type} onChange={set("type")}>
        <option value="telegram_join">Telegram চ্যানেল Join</option>
        <option value="timer_visit">লিংক ভিজিট (টাইমার)</option>
      </select>
      <label>শিরোনাম</label>
      <input value={f.title} onChange={set("title")} />
      <label>Reward</label>
      <input inputMode="numeric" value={f.reward} onChange={set("reward")} />
      {f.type === "telegram_join" ? (
        <>
          <label>Channel ID (@username)</label>
          <input value={f.channel_id} onChange={set("channel_id")} placeholder="@mychannel" />
          <label>Join লিংক (ঐচ্ছিক)</label>
          <input value={f.url} onChange={set("url")} placeholder="https://t.me/mychannel" />
        </>
      ) : (
        <>
          <label>URL</label>
          <input value={f.url} onChange={set("url")} placeholder="https://x.com/handle" />
          <label>ন্যূনতম অপেক্ষা (সেকেন্ড)</label>
          <input inputMode="numeric" value={f.min_wait_seconds} onChange={set("min_wait_seconds")} />
        </>
      )}
      <div style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => act({ action: "saveTask", ...f })}>
          টাস্ক যোগ করুন
        </button>
      </div>
    </div>
  );
}
