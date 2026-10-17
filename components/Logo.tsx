import React, { useEffect, useId, useState } from "react";
import { LOGO_SOURCES, USDT_SOURCES } from "@/lib/brand";

/** প্রথমবার আনলে localStorage-এ data-URL হিসেবে রাখি; পরের বার নেটওয়ার্ক ছাড়াই সাথে সাথে দেখায় */
const pending: Record<string, Promise<string | null> | undefined> = {};
const found: Record<string, string | undefined> = {};

function probe(src: string): Promise<boolean> {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im.naturalWidth > 0);
    im.onerror = () => res(false);
    im.src = src;
  });
}

/** প্রথম যে উৎসটা সত্যিই লোড হয় সেটা (ভাঙা ছবি কখনো দেখানো হয় না) */
function resolveLogo(kind: string, sources: string[]): Promise<string | null> {
  return (pending[kind] ||= (async () => {
    try { const v = localStorage.getItem("tfuel_logo_" + kind); if (v && (await probe(v))) return (found[kind] = v); } catch {}
    for (const s of sources) {
      if (!(await probe(s))) continue;
      found[kind] = s;
      try {
        const r = await fetch(s, { mode: "cors" });
        const b = r.ok ? await r.blob() : null;
        if (b && b.type.startsWith("image") && b.size <= 250000) {
          const du = await new Promise<string>((ok, bad) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = bad; f.readAsDataURL(b); });
          localStorage.setItem("tfuel_logo_" + kind, du);
        }
      } catch {}
      return s;
    }
    return null;
  })());
}

/** লোগো: নিজস্ব SVG কয়েন সাথে সাথে দেখায়, আসল ছবি লোড হলে বদলে দেয় (কখনো ভাঙা ছবি/ফাঁকা নয়) */
export default function Logo({ size = 32, className = "", style, kind = "tfuel" }: { size?: number; className?: string; style?: React.CSSProperties; kind?: "tfuel" | "usdt" }) {
  const sources = kind === "usdt" ? USDT_SOURCES : LOGO_SOURCES;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    if (found[kind]) setSrc(found[kind]!);
    resolveLogo(kind, sources).then((s) => { if (s && !dead) setSrc(s); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  const gid = "lg" + useId().replace(/[^a-zA-Z0-9]/g, "");
  if (src)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} className={className} style={{ objectFit: "contain", ...style }} draggable={false} />;
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
