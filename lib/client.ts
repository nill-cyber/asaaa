// শুধু browser-এ চলে
declare global {
  interface Window {
    Telegram?: { WebApp?: any };
  }
}

export function tg() {
  return typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
}

export async function api<T = any>(path: string, body: Record<string, any> = {}): Promise<T> {
  const initData = tg()?.initData || "";
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${initData}` };
  try {
    const adm = typeof window !== "undefined" ? sessionStorage.getItem("adm") : null;
    if (adm) headers["x-admin-token"] = adm;
  } catch {}
  const r = await fetch(`/api/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.success === false) {
    const err: any = new Error(data.error || `Error ${r.status}`);
    err.data = data; // attempts_left, retry_at, min ইত্যাদি
    throw err;
  }
  return data as T;
}

export function openLink(url: string) {
  const w = tg();
  if (w?.openLink) w.openLink(url);
  else window.open(url, "_blank");
}

export function openTgLink(url: string) {
  const w = tg();
  if (w?.openTelegramLink && /^https:\/\/t\.me\//.test(url)) w.openTelegramLink(url);
  else openLink(url);
}

const ERR: Record<string, string> = {
  no_site_available: "এখন কোনো সাইট খালি নেই, পরে চেষ্টা করুন",
  no_active_run: "আগে Article Site চাপুন",
  finish_articles_first: "আগে সব আর্টিকেল ক্রমে পড়ে কোড নিন",
  code_expired: "কোডের মেয়াদ শেষ। শেষ আর্টিকেলে গিয়ে আবার \"কোড নিন\" চাপুন",
  wrong_code: "কোড ভুল",
  locked: "বেশি ভুল হয়েছে, নতুন করে Article Site চাপুন",
  already_claimed: "এই কোড আগেই ব্যবহার হয়েছে",
  code_must_be_6_digits: "৬ ডিজিটের কোড দিন",
  below_minimum: "ন্যূনতম পরিমাণের কম",
  insufficient: "যথেষ্ট coin নেই",
  bad_method: "পদ্ধতি বেছে নিন",
  bad_account: "অ্যাকাউন্ট নম্বর দিন",
};

/** ত্রুটির কোড → বাংলা বার্তা */
export function errText(e: any): string {
  return ERR[e?.message] || e?.message || "সমস্যা হয়েছে";
}
