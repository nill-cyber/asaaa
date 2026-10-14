/** আর্টিকেল-চেইনের সাধারণ সাহায্যকারী */

export interface ArticleSite {
  name: string;
  urls: string[];
  reward: number;
  cooldown_minutes: number;
  dwell_seconds: number; // মোট সময় প্রতি আর্টিকেলে
  lock_seconds?: number; // শুরুতে এতক্ষণ scroll বন্ধ (শুধু ওপরটা পড়া); তারপর বাকি সময় scroll করা যায়
  is_active: boolean;
}

export interface Run {
  uid: string;
  site_id: string;
  total: number;
  reward: number;
  step_arrived: number;
  step_done: number;
  arrived_at: number;
  status: "running" | "code_issued" | "claimed" | "dead";
  failed: number;
  created_at: number;
  expires_at: number;
  code_hash?: string;
  code_expires_at?: number;
  claimed_at?: number;
}

/** host স্বাভাবিক করা: www বাদ, blogspot-এর দেশভিত্তিক ডোমেইন একই ধরা */
export function normHost(h: string): string {
  return h
    .toLowerCase()
    .trim()
    .replace(/^www\./, "")
    .replace(/\.blogspot\.[a-z.]+$/, ".blogspot.com");
}

/** URL → "host/path" (query, #, শেষের / বাদ)। অবৈধ হলে null */
export function normUrl(u: string): string | null {
  try {
    const p = new URL(u.trim());
    if (p.protocol !== "https:" && p.protocol !== "http:") return null;
    let path = "/" + decodeURIComponent(p.pathname).replace(/^\/+|\/+$/g, "");
    return normHost(p.hostname) + path;
  } catch {
    return null;
  }
}

export const hostOf = (u: string) => (normUrl(u) || "").split("/")[0];

export function urlWithRun(url: string, token: string): string {
  return url + (url.includes("?") ? "&" : "?") + "r=" + token;
}

export const isToken = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{32}$/.test(v);
