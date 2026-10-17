import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icons";

type Call = <T = any>(body: Record<string, any>, okMsg?: string) => Promise<T | null>;
const Toggle = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
  <button className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)} aria-pressed={on} />
);
const when = (t?: number) => (t ? new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const copy = (t: string) => navigator.clipboard?.writeText(t);
const Head = ({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) => (
  <div className="ph"><div><h1>{title}</h1>{sub && <div className="muted sm" style={{ marginTop: 2 }}>{sub}</div>}</div><div className="toolbar" style={{ margin: 0 }}>{children}</div></div>
);
const Code = ({ children }: { children: string }) => (
  <div style={{ position: "relative", marginTop: 8 }}>
    <pre style={{ background: "var(--soft)", borderRadius: 12, padding: 12, overflowX: "auto", fontSize: 12, lineHeight: 1.5, margin: 0, userSelect: "text" }}>{children}</pre>
    <button className="btn sec sm" style={{ position: "absolute", top: 6, right: 6 }} onClick={() => copy(children)}><Icon name="copy" size={13} /></button>
  </div>
);

const blank = { id: "", name: "", domain: "https://", login_url: "", webhook: "", fee_pct: "0", max_usd: "500", allow_tfuel: true, allow_usdt: true, enabled: true };

/** Admin → Shops: partner shops (auto-login + pay with TFUEL / USDT), orders, integration guide */
export function ShopsPage({ call }: { call: Call }) {
  const [d, setD] = useState<any>(null);
  const [o, setO] = useState<any>(null);
  const [f, setF] = useState<any>(null);
  const [secret, setSecret] = useState<{ id: string; secret: string } | null>(null);
  const [filter, setFilter] = useState("all");
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([call({ action: "shopList" }), call({ action: "shopOrders" })]);
    if (a) setD(a);
    if (b) setO(b);
  }, [call]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="empty">Loading…</div>;
  const base = typeof window !== "undefined" ? window.location.origin : "https://YOUR-APP.vercel.app";
  const save = async () => {
    const r: any = await call({ action: "shopSave", ...f }, "Saved");
    if (r) { if (r.secret) setSecret({ id: r.id, secret: r.secret }); setF(null); load(); }
  };
  const orders = (o?.items || []).filter((x: any) => filter === "all" || x.status === filter);
  const sid = secret?.id || "YOUR_SHOP_ID";
  const sec = secret?.secret || "YOUR_SECRET";
  return (
    <>
      <Head title="Shops" sub="Partner shops: users sign in with Telegram and pay with TFUEL or USDT">
        <button className="btn" onClick={() => setF({ ...blank })}><Icon name="plus" size={15} /> Add shop</button>
      </Head>

      <div className="card">
        <div className="row"><div><div className="title">Enable shop payments</div><div className="sub">Master switch. Off = shop login and payments stop everywhere.</div></div><Toggle on={d.enabled} onChange={async (v) => { if (await call({ action: "shopToggleAll", on: v }, v ? "Shops on" : "Shops off")) load(); }} /></div>
        <div className="xs muted" style={{ marginTop: 8 }}>Needs your bot link set in Settings → Referral link (https://t.me/yourbot/app), because payment links open the Mini App.</div>
      </div>

      {secret && (
        <div className="card" style={{ border: "2px solid var(--gold2, #e0a800)" }}>
          <div className="title">Save this secret now — it is shown only once</div>
          <div className="sub">Give the Shop ID and secret to the shop developer. Keep the secret on their server only (never in website JavaScript).</div>
          <div className="addrbox" style={{ marginTop: 8 }}><span>Shop ID: {secret.id}</span><button className="btn sec sm" onClick={() => copy(secret.id)}><Icon name="copy" size={14} /></button></div>
          <div className="addrbox" style={{ marginTop: 6 }}><span>{secret.secret}</span><button className="btn sec sm" onClick={() => copy(secret.secret)}><Icon name="copy" size={14} /></button></div>
          <button className="btn sec sm" style={{ marginTop: 10 }} onClick={() => setSecret(null)}>I saved it</button>
        </div>
      )}

      {f && (
        <div className="card">
          <div className="title">{f.id ? "Edit shop" : "New shop"}</div>
          <div className="grid2">
            <div><label>Shop name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div><label>Shop website (https)</label><input value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} placeholder="https://myshop.com" /></div>
            <div><label>Login URL (receives ?code=…)</label><input value={f.login_url} onChange={(e) => setF({ ...f, login_url: e.target.value })} placeholder="https://myshop.com/auth/tfuel" /></div>
            <div><label>Payment webhook URL (optional)</label><input value={f.webhook} onChange={(e) => setF({ ...f, webhook: e.target.value })} placeholder="https://myshop.com/tfuel/webhook" /></div>
            <div><label>Our fee on each sale (%)</label><input inputMode="decimal" value={f.fee_pct} onChange={(e) => setF({ ...f, fee_pct: e.target.value })} /></div>
            <div><label>Max order (USD)</label><input inputMode="decimal" value={f.max_usd} onChange={(e) => setF({ ...f, max_usd: e.target.value })} /></div>
          </div>
          <div className="row" style={{ marginTop: 12 }}><div className="title">Accept TFUEL</div><Toggle on={f.allow_tfuel} onChange={(v) => setF({ ...f, allow_tfuel: v })} /></div>
          <div className="row" style={{ marginTop: 8 }}><div className="title">Accept USDT</div><Toggle on={f.allow_usdt} onChange={(v) => setF({ ...f, allow_usdt: v })} /></div>
          <div className="row" style={{ marginTop: 8 }}><div className="title">Shop enabled</div><Toggle on={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} /></div>
          <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}><button className="btn" onClick={save}>Save</button><button className="btn sec" onClick={() => setF(null)}>Cancel</button></div>
        </div>
      )}

      {d.shops.length === 0 && !f && <div className="card empty">No shops yet. Add your first partner shop.</div>}
      {d.shops.map((s: any) => (
        <div className="card" key={s.id}>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="b" style={{ fontSize: 16 }}>{s.name} <span className={`tag ${s.enabled ? "ok" : "err"}`}>{s.enabled ? "live" : "off"}</span></div>
              <div className="sm">{s.domain} · fee {s.fee_pct}% · max ${s.max_usd}</div>
              <div className="xs muted">ID {s.id} · {s.allow_tfuel ? "TFUEL " : ""}{s.allow_usdt ? "USDT" : ""}{s.webhook ? " · webhook on" : ""}</div>
            </div>
            <div className="gap">
              <button className="btn sec sm" onClick={() => setF({ ...s, fee_pct: String(s.fee_pct), max_usd: String(s.max_usd) })}>Edit</button>
              <button className="btn sec sm" onClick={async () => { if (confirm("Create a new secret? The old one stops working immediately.")) { const r: any = await call({ action: "shopRotate", id: s.id }, "New secret created"); if (r) setSecret({ id: s.id, secret: r.secret }); } }}>New secret</button>
              <button className="btn danger sm" onClick={async () => { if (confirm("Delete this shop? Existing orders stay in the log.")) { if (await call({ action: "shopDelete", id: s.id }, "Deleted")) load(); } }}><Icon name="trash" size={14} /></button>
            </div>
          </div>
        </div>
      ))}

      {o?.totals?.length > 0 && (
        <div className="card">
          <div className="title" style={{ marginBottom: 6 }}>Settlement (last 300 orders)</div>
          {o.totals.map((t: any) => (
            <div className="row" key={t.id} style={{ marginBottom: 6 }}>
              <div><div className="b">{t.name}</div><div className="xs muted">{t.n} paid orders · refunded ${t.refunded.toFixed(2)}</div></div>
              <div style={{ textAlign: "right" }}><div className="b num">Owed to shop: ${t.owed.toFixed(2)}</div><div className="xs muted">Sales ${t.paid.toFixed(2)} · our fee ${t.fee.toFixed(2)}</div></div>
            </div>
          ))}
          <div className="xs muted">Settlement is manual: pay each shop the “owed” amount in USDT, as agreed with them.</div>
        </div>
      )}

      <div className="seg" style={{ marginBottom: 10 }}>
        {["all", "paid", "open", "refunded", "expired"].map((k) => <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}
      </div>
      {orders.length === 0 && <div className="card empty">No orders</div>}
      {orders.map((x: any) => (
        <div className="card" key={x.id}>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="b num">${x.usd.toFixed(2)} · {x.shop_name}</div>
              <div className="sm">{x.title || "—"} · ref {x.ref}</div>
              <div className="xs muted">{x.status === "paid" || x.status === "refunded" ? `Paid ${x.cur === "usdt" ? x.usdt.toFixed(2) + " USDT" : x.coins + " coins"} · user ${x.uid} · ` : ""}{when(x.created_at)}{x.status === "paid" ? ` · webhook ${x.webhook_ok === undefined ? "—" : x.webhook_ok ? "ok" : "failed"}` : ""}</div>
            </div>
            <div className="gap">
              <span className={`tag ${x.status === "paid" ? "ok" : x.status === "open" ? "warn" : "err"}`}>{x.status}</span>
              {x.status === "paid" && <button className="btn danger sm" onClick={async () => { if (confirm("Refund this order to the user?")) { if (await call({ action: "shopRefund", id: x.id }, "Refunded")) load(); } }}>Refund</button>}
            </div>
          </div>
        </div>
      ))}

      <div className="card">
        <div className="title">How a shop connects (give this to the shop developer)</div>
        <div className="sub">Everything is signed with the shop&apos;s secret. Calls go from the shop&apos;s <b>server</b> to this app — never from the browser.</div>
        <ol className="sm" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
          <li><b>Login:</b> user taps the shop in the Mini App → lands on your Login URL with <code>?code=…</code> → your server exchanges the code for the Telegram user → create your own session.</li>
          <li><b>Pay:</b> your server creates an order → redirect the user to the returned <code>pay_url</code> → the Mini App opens, the user picks TFUEL or USDT and confirms → you get a webhook and the user returns to your site.</li>
          <li><b>Deliver only after payment is confirmed</b> by the webhook or the status call — never trust the browser redirect.</li>
        </ol>
        <details style={{ marginTop: 8 }}>
          <summary className="b" style={{ cursor: "pointer" }}>Node.js example</summary>
          <Code>{`const crypto = require("crypto");
const BASE = "${base}";
const SHOP_ID = "${sid}";
const SECRET = "${sec}";   // keep on the server only

async function tfuel(path, body) {
  const raw = JSON.stringify(body), ts = Date.now().toString();
  const sig = crypto.createHmac("sha256", SECRET).update(ts + "." + raw).digest("hex");
  const r = await fetch(BASE + "/api/shop/" + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-shop-id": SHOP_ID, "x-timestamp": ts, "x-signature": sig },
    body: raw,
  });
  return r.json();
}

// 1) Login route = your "Login URL"
app.get("/auth/tfuel", async (req, res) => {
  const r = await tfuel("exchange", { code: req.query.code });
  if (!r.success) return res.status(401).send("Login failed");
  req.session.user = r.user;            // { id, name, username }
  res.redirect("/");
});

// 2) Checkout
app.post("/checkout", async (req, res) => {
  const o = await tfuel("order", {
    ref: "ORDER-" + req.body.orderId,   // your own unique order number
    amount: 12.5,                       // price in USD
    title: "Pro plan",
    user_id: req.session.user.id,       // optional: only this user may pay
    return_url: "https://myshop.com/thanks",
  });
  res.redirect(o.pay_url);
});

// 3) Webhook (set its URL in this panel)
app.post("/tfuel/webhook", express.raw({ type: "*/*" }), (req, res) => {
  const ts = req.headers["x-timestamp"];
  const sig = crypto.createHmac("sha256", SECRET).update(ts + "." + req.body.toString()).digest("hex");
  if (sig !== req.headers["x-signature"]) return res.sendStatus(401);
  const e = JSON.parse(req.body);       // { event, ref, status, usd, currency, user_id }
  if (e.event === "order.paid") { /* mark your order e.ref as paid */ }
  res.sendStatus(200);
});

// Optional: check an order any time
// await tfuel("status", { ref: "ORDER-1001" })   -> { status: "paid" | "open" | "expired" | "refunded" }
// Optional: refund
// await tfuel("refund", { order_id: "..." })`}</Code>
        </details>
        <details style={{ marginTop: 8 }}>
          <summary className="b" style={{ cursor: "pointer" }}>PHP example</summary>
          <Code>{`<?php
const BASE = "${base}";
const SHOP_ID = "${sid}";
const SECRET = "${sec}";   // keep on the server only

function tfuel($path, $body) {
  $raw = json_encode($body); $ts = (string) round(microtime(true) * 1000);
  $sig = hash_hmac("sha256", $ts . "." . $raw, SECRET);
  $ch = curl_init(BASE . "/api/shop/" . $path);
  curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $raw, CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ["content-type: application/json", "x-shop-id: " . SHOP_ID, "x-timestamp: " . $ts, "x-signature: " . $sig]]);
  return json_decode(curl_exec($ch), true);
}

// Login URL (/auth/tfuel):
$r = tfuel("exchange", ["code" => $_GET["code"]]);
if ($r["success"]) { $_SESSION["user"] = $r["user"]; header("Location: /"); }

// Checkout:
$o = tfuel("order", ["ref" => "ORDER-1001", "amount" => 12.5, "title" => "Pro plan", "user_id" => $_SESSION["user"]["id"]]);
header("Location: " . $o["pay_url"]);

// Webhook:
$raw = file_get_contents("php://input");
$ok = hash_equals(hash_hmac("sha256", $_SERVER["HTTP_X_TIMESTAMP"] . "." . $raw, SECRET), $_SERVER["HTTP_X_SIGNATURE"]);
if ($ok) { $e = json_decode($raw, true); /* if ($e["event"] === "order.paid") mark $e["ref"] paid */ http_response_code(200); }`}</Code>
        </details>
        <div className="xs muted" style={{ marginTop: 10 }}>Rules: timestamps must be within 5 minutes · an order is valid for 30 minutes · sending the same <code>ref</code> again returns the same order (no double charge) · the shop sets prices in USD; users pay the live TFUEL equivalent or the same amount in USDT.</div>
      </div>
    </>
  );
}

/** Admin → Support inbox */
export function SupportPage({ call }: { call: Call }) {
  const [items, setItems] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("open");
  const load = useCallback(async () => { const r: any = await call({ action: "supportList" }); if (r) setItems(r.items); }, [call]);
  useEffect(() => { load(); }, [load]);
  const openT = async (id: string) => { const r: any = await call({ action: "supportGet", id }); if (r) { setSel(r.ticket); setText(""); } };
  const shown = items.filter((x) => filter === "all" || (filter === "open" ? x.status === "open" : x.status === filter));
  const pend = items.filter((x) => x.status === "open").length;
  return (
    <>
      <Head title="Support" sub="Messages from users. Replies are sent to them as a notification." />
      <div className="seg" style={{ marginBottom: 10 }}>
        {["open", "answered", "closed", "all"].map((k) => <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{k[0].toUpperCase() + k.slice(1)}{k === "open" && pend ? ` (${pend})` : ""}</button>)}
      </div>
      {sel && (
        <div className="card">
          <div className="row"><div><div className="b">{sel.subject}</div><div className="xs muted">{sel.name} · ID {sel.uid}</div></div><button className="btn ghost sm" onClick={() => setSel(null)}><Icon name="x" size={16} /></button></div>
          <div style={{ marginTop: 10 }}>
            {sel.msgs.map((m: any, i: number) => (
              <div key={i} style={{ margin: "6px 0", padding: "8px 10px", borderRadius: 12, background: m.f === "admin" ? "var(--soft)" : "transparent", border: "1px solid var(--line)" }}>
                <div className="xs muted">{m.f === "admin" ? "You" : "User"} · {when(m.at)}</div>
                <div style={{ whiteSpace: "pre-wrap", userSelect: "text" }}>{m.t}</div>
              </div>
            ))}
          </div>
          {sel.status !== "closed" && (
            <>
              <textarea rows={3} placeholder="Write a reply…" value={text} onChange={(e) => setText(e.target.value)} style={{ marginTop: 8 }} />
              <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
                <button className="btn" disabled={text.trim().length < 2} onClick={async () => { if (await call({ action: "supportReply", id: sel.id, message: text }, "Reply sent")) { openT(sel.id); load(); } }}>Send reply</button>
                <button className="btn sec" onClick={async () => { if (await call({ action: "supportClose", id: sel.id }, "Closed")) { setSel(null); load(); } }}>Close ticket</button>
              </div>
            </>
          )}
        </div>
      )}
      {shown.length === 0 && <div className="card empty">No tickets</div>}
      {shown.map((x) => (
        <div className="card" key={x.id} style={{ cursor: "pointer" }} onClick={() => openT(x.id)}>
          <div className="row"><div><div className="b">{x.subject}</div><div className="xs muted">{x.name} · ID {x.uid} · {x.n} messages · {when(x.updated_at)}</div></div><span className={`tag ${x.status === "open" ? "warn" : x.status === "answered" ? "ok" : ""}`}>{x.status}</span></div>
        </div>
      ))}
    </>
  );
}
