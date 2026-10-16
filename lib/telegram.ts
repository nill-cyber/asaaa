import { sha256 } from "./crypto";
/** Telegram Bot API call — সবসময় {ok, result, description} ফেরত দেয়, কখনো throw করে না */
export async function tgCall(method: string, params: Record<string, string | number> = {}) {
  const token = process.env.BOT_TOKEN;
  if (!token) return { ok: false, description: "BOT_TOKEN is not set" } as any;
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}?${qs}`);
    return (await r.json()) as { ok: boolean; result?: any; description?: string };
  } catch (e: any) {
    return { ok: false, description: `Network error: ${e?.message || e}` } as any;
  }
}

/** webhook-এর গোপন টোকেন (BOT_TOKEN থেকে তৈরি, আলাদা env লাগে না) */
export const webhookSecret = () => sha256("tgwh:" + (process.env.BOT_TOKEN || "")).slice(0, 40);
