import { ServerValue } from "firebase-admin/database";
import { db } from "./firebase";
import { randomId } from "./crypto";
import { getSettings } from "./settings";
import { tgCall } from "./telegram";

/** অ্যাপের ভেতরের inbox (🔔)। Telegram বন্ধ/ব্লক থাকলেও জমা হয়। counter আলাদা node-এ, যাতে user record অক্ষত থাকে */
export async function inboxPush(uid: string, text: string) {
  try {
    await db().ref().update({
      [`inbox/${uid}/${String(Date.now()).padStart(13, "0")}${randomId().slice(0, 6)}`]: { m: String(text).slice(0, 300), at: Date.now() },
      [`inbox_meta/${uid}/unread`]: ServerValue.increment(1),
    });
  } catch {}
}

/** Telegram bot দিয়ে user-কে বার্তা (best-effort: user bot চালু না করলে/ব্লক করলে চুপচাপ বাদ) */
export async function notify(uid: string, text: string, force = false) {
  await inboxPush(uid, text);
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
