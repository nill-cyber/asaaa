import { wrapShop, useLoginCode } from "@/lib/shop";
import { db } from "@/lib/firebase";
import { HttpError } from "@/lib/auth";

export const config = { api: { bodyParser: false } };

/** shop সার্ভার: লগইন কোড দিয়ে Telegram user-এর পরিচয় পায় */
export default wrapShop(async ({ id, body }, res) => {
  const code = String(body.code || "");
  if (!/^[0-9a-f]{32}$/.test(code)) throw new HttpError(400, "bad_code");
  const uid = await useLoginCode(code, id);
  const idx = ((await db().ref(`user_index/${uid}`).get()).val() || {}) as { name?: string; username?: string };
  if (!(await db().ref(`shop_links/${uid}/${id}`).get()).exists()) throw new HttpError(403, "not_connected");
  res.json({ success: true, user: { id: uid, name: idx.name || "User", username: idx.username || "" } });
});
