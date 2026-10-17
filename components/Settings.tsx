import { useCallback, useEffect, useState } from "react";
import { api, errText } from "@/lib/client";
import Icon from "@/components/Icons";
import { getTheme, setTheme, Theme } from "@/lib/theme";

type Say = (t: string, ok?: boolean) => void;
export interface Account { pin: boolean; pin_locked: boolean; cur: "tfuel" | "usdt" | null; login_alert: boolean; devices: { label: string; last: number; first: number }[]; addrs: { id: string; label: string; address: string }[] }

/** PIN ও Saved addresses — Settings ও withdraw ফর্ম দুই জায়গাই ব্যবহার করে */
export function useAccount() {
  const [a, setA] = useState<Account | null>(null);
  const load = useCallback(async () => {
    try { setA(await api<Account>("account", { action: "get" })); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);
  return { a, setA, load };
}

/** PIN সেট থাকলে ঘর দেখায় (withdraw ফর্মে) */
export function PinField({ acc, value, onChange }: { acc: Account | null; value: string; onChange: (v: string) => void }) {
  if (!acc?.pin) return null;
  return (
    <>
      <label>Withdraw PIN</label>
      <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} placeholder="4–6 digit PIN" value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} />
    </>
  );
}

/** সেভ করা ঠিকানা বেছে নিলে ঘর ভরে যায় */
export function AddrPicker({ acc, onPick }: { acc: Account | null; onPick: (address: string) => void }) {
  if (!acc?.addrs.length) return null;
  return (
    <select defaultValue="" style={{ marginBottom: 6 }} onChange={(e) => { if (e.target.value) onPick(e.target.value); e.target.value = ""; }}>
      <option value="">Use a saved address…</option>
      {acc.addrs.map((x) => <option key={x.id} value={x.address}>{x.label} · {x.address.slice(0, 6)}…{x.address.slice(-4)}</option>)}
    </select>
  );
}

export function SettingsPanel({ say, notify, account, onCur }: { say: Say; notify?: React.ReactNode; account?: React.ReactNode; onCur?: (c: "tfuel" | "usdt") => void }) {
  const { a, setA, load } = useAccount();
  const [theme, setT] = useState<Theme>("light");
  useEffect(() => setT(getTheme()), []);
  const [cur, setCur] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [addr, setAddr] = useState("");
  const [fp, setFp] = useState<"" | "code">("");
  const [code, setCode] = useState("");

  const act = async (body: any, ok: string) => {
    setBusy(true);
    try {
      setA(await api<Account>("account", body));
      say(ok, true);
      return true;
    } catch (e: any) {
      say(errText(e));
      load();
      return false;
    } finally { setBusy(false); }
  };
  if (!a) return <div className="small muted">Loading…</div>;

  return (
    <>
      <div className="mhead" style={{ marginTop: 4 }}>Appearance</div>
      <div className="card">
      <div className="sub" style={{ marginBottom: 8 }}>Choose how the app looks. Auto follows your phone.</div>
      <div className="seg" style={{ marginBottom: 0 }}>
        {(["light", "dark", "auto"] as Theme[]).map((t) => (
          <button key={t} className={theme === t ? "on" : ""} onClick={() => { setT(t); setTheme(t); }}>{t === "auto" ? "Auto" : t === "dark" ? "Dark" : "Light"}</button>
        ))}
      </div>
      </div>

      <div className="mhead">Preferences</div>
      <div className="card">
        <div className="title">Default currency</div>
        <div className="sub" style={{ marginBottom: 8 }}>Used to show your balance and as the default when you pay in a shop.</div>
        <div className="seg" style={{ marginBottom: 0 }}>
          {(["tfuel", "usdt"] as const).map((c) => (
            <button key={c} className={a.cur === c ? "on" : ""} disabled={busy} onClick={async () => { if (await act({ action: "setCur", cur: c }, "Currency saved")) onCur?.(c); }}>{c === "tfuel" ? "TFUEL" : "USDT"}</button>
          ))}
        </div>
      </div>

      <div className="mhead">Security</div>
      <div className="card">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="left">
          <div className="ico green"><Icon name="lock" /></div>
          <div>
            <div className="title">Withdraw PIN</div>
            <div className="sub">{a.pin ? "On — needed for every withdrawal." : "Off. Add a PIN to protect your withdrawals."}</div>
          </div>
        </div>
      </div>
      {a.pin_locked && <div className="banner warn"><Icon name="alert" size={18} /><span>Too many wrong PINs. Locked for a few minutes.</span></div>}
      {a.pin && (<><label>Current PIN</label><input type="password" inputMode="numeric" maxLength={6} autoComplete="off" value={cur} onChange={(e) => setCur(e.target.value.replace(/\D/g, ""))} /></>)}
      <label>{a.pin ? "New PIN (4–6 digits)" : "Choose a PIN (4–6 digits)"}</label>
      <input type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
      <div className="grid2" style={{ marginTop: 10 }}>
        <button className="btn" disabled={busy || pin.length < 4 || (a.pin && cur.length < 4)} onClick={async () => { if (await act({ action: "setPin", pin, current: cur }, a.pin ? "PIN changed" : "PIN is on")) { setPin(""); setCur(""); } }}>{a.pin ? "Change PIN" : "Turn on PIN"}</button>
        {a.pin && <button className="btn sec" disabled={busy || cur.length < 4} onClick={async () => { if (await act({ action: "removePin", current: cur }, "PIN turned off")) setCur(""); }}>Turn off</button>}
      </div>
      {a.pin && fp === "" && <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={async () => { if (await act({ action: "pinResetRequest" }, "We sent a 6-digit code to your Telegram")) setFp("code"); }}>Forgot your PIN?</button>}
      {a.pin && fp === "code" && (
        <div style={{ marginTop: 10 }}>
          <label>6-digit code from Telegram</label>
          <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <label>New PIN (4–6 digits)</label>
          <input type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          <button className="btn block" style={{ marginTop: 10 }} disabled={busy || code.length !== 6 || pin.length < 4} onClick={async () => { if (await act({ action: "pinResetConfirm", code, pin }, "PIN reset")) { setFp(""); setCode(""); setPin(""); } }}>Reset PIN</button>
        </div>
      )}
      </div>

      <div className="card">
        <div className="row">
          <div><div className="title">Login alerts</div><div className="sub">Get a Telegram message when your account is opened on a new device.</div></div>
          <button className={`switch ${a.login_alert ? "on" : ""}`} disabled={busy} aria-label="Toggle login alerts" style={{ flexShrink: 0 }} onClick={() => act({ action: "setLoginAlert", on: !a.login_alert }, a.login_alert ? "Login alerts off" : "Login alerts on")} />
        </div>
        {a.devices.length > 0 && <div className="title" style={{ fontSize: 13, margin: "12px 0 4px" }}>Recent devices</div>}
        {a.devices.map((d, i) => (
          <div className="hist" key={i}><div><div className="title" style={{ fontSize: 14 }}>{d.label}</div><div className="sub">Last used {new Date(d.last).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div></div></div>
        ))}
      </div>

      <div className="mhead">Saved addresses</div>
      <div className="card">
      {a.addrs.length === 0 && <div className="small muted">No saved addresses yet.</div>}
      {a.addrs.map((x) => (
        <div className="hist" key={x.id}>
          <div style={{ minWidth: 0 }}>
            <div className="title">{x.label}</div>
            <div className="sub" style={{ wordBreak: "break-all" }}>{x.address}</div>
          </div>
          <button className="btn sec sm" aria-label="Delete address" disabled={busy} onClick={() => act({ action: "delAddr", id: x.id }, "Removed")}><Icon name="trash" size={14} /></button>
        </div>
      ))}
      {a.addrs.length < 10 && (
        <>
          <label>Label</label>
          <input maxLength={20} placeholder="e.g. Binance TRC20" value={label} onChange={(e) => setLabel(e.target.value)} />
          <label>Address / account</label>
          <input maxLength={100} placeholder="Paste address" value={addr} onChange={(e) => setAddr(e.target.value)} />
          <button className="btn block" style={{ marginTop: 10 }} disabled={busy || !label.trim() || addr.trim().length < 6} onClick={async () => { if (await act({ action: "addAddr", label, address: addr }, "Address saved")) { setLabel(""); setAddr(""); } }}>Save address</button>
        </>
      )}
      </div>
      {notify && (<><div className="mhead">Notifications</div><div className="card">{notify}</div></>)}
      {account && (<><div className="mhead">Account</div><div className="card">{account}</div></>)}
    </>
  );
}
