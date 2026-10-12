import { db } from "./firebase";
import { getSettings } from "./settings";
import { tgCall } from "./telegram";

/** Telegram bot দিয়ে user-কে বার্তা (best-effort: user bot চালু না করলে/ব্লক করলে চুপচাপ বাদ) */
export async function notify(uid: string, text: string, force = false) {
  try {
    const s = await getSettings();
    if (!s.notify_enabled && !force) return false;
    if (!force && (await db().ref(`users/${uid}/notify_off`).get()).val()) return false;
    const params: Record<string, string | number> = { chat_id: uid, text: text.slice(0, 600), disable_web_page_preview: "true" };
    const link = s.referral_link;
    if (link) params.reply_markup = JSON.stringify({ inline_keyboard: [[{ text: "Open app", url: link }]] });
    const r = await tgCall("sendMessage", params);
    return !!r.ok;
  } catch {
    return false;
  }
}
