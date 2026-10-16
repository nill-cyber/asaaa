import React, { useEffect, useId, useState } from "react";
import { LOGO_SOURCES, USDT_SOURCES } from "@/lib/brand";

/** প্রথমবার আনলে localStorage-এ data-URL হিসেবে রাখি; পরের বার নেটওয়ার্ক ছাড়াই সাথে সাথে দেখায় */
const pending: Record<string, Promise<string | null> | undefined> = {};
function fetchData(kind: string, sources: string[]): Promise<string | null> {
  return (pending[kind] ||= (async () => {
    for (const s of sources) {
      try {
        const r = await fetch(s, { mode: "cors" });
        if (!r.ok) continue;
        const b = await r.blob();
        if (!b.type.startsWith("image") || b.size > 250000) continue;
        const du = await new Promise<string>((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result)); f.onerror = rej; f.readAsDataURL(b); });
        try { localStorage.setItem("tfuel_logo_" + kind, du); } catch {}
        return du;
      } catch {}
    }
    return null;
  })());
}

/** লোগো: public/logo.png → iili.io (পূর্ণ) → iili.io (thumbnail) → নিজস্ব SVG কয়েন */
export default function Logo({ size = 32, className = "", style, kind = "tfuel" }: { size?: number; className?: string; style?: React.CSSProperties; kind?: "tfuel" | "usdt" }) {
  const [i, setI] = useState(0);
  const sources = kind === "usdt" ? USDT_SOURCES : LOGO_SOURCES;
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    try { const v = localStorage.getItem("tfuel_logo_" + kind); if (v) { setData(v); return; } } catch {}
    fetchData(kind, sources).then((d) => { if (d && !dead) setData(d); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  const gid = "lg" + useId().replace(/[^a-zA-Z0-9]/g, "");
  if (data && i < sources.length) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={data} alt="" width={size} height={size} className={className} style={{ objectFit: "contain", ...style }} draggable={false} onError={() => { try { localStorage.removeItem("tfuel_logo_" + kind); } catch {} setData(null); }} />;
  }
  if (i >= sources.length) {
    if (kind === "usdt")
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" className={className} style={style} aria-hidden>
          <circle cx="24" cy="24" r="22" fill="#26A17B" />
          <path d="M14 16h20M24 16v18M17 22c0 2 3 3 7 3s7-1 7-3" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" />
        </svg>
      );
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" className={className} style={style} aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFD86B" />
            <stop offset="1" stopColor="#F59E0B" />
          </linearGradient>
        </defs>
        <circle cx="24" cy="24" r="22" fill={`url(#${gid})`} />
        <circle cx="24" cy="24" r="16" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="2" />
        <path d="M17 17h14M24 17v16" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sources[i]}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain", ...style }}
      draggable={false}
      onError={() => setI(i + 1)}
    />
  );
}
