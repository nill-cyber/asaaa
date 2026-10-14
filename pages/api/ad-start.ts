import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { dayKey } from "@/lib/log";
import { randomToken } from "@/lib/crypto";
import { ensureUser, newUser, UserRecord } from "@/lib/user";

export const PURPOSES = ["coins", "energy", "spin"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const MIN_AD_SECONDS = 4;

/** ad দেখার আগে: টোকেন নেয় (server সময় মাপে)। দৈনিক সীমা এখানেও দেখে। */
export default route(async (req, res) => {
  const user = authenticate(req);
  await rateLimit(user.id, "ad-start", 12);
  const { settings: s } = await ensureUser(user);
  const purpose = String(req.body?.purpose || "") as Purpose;
  if (!PURPOSES.includes(purpose)) throw new HttpError(400, "bad_purpose");
  if (!s.ads_enabled || !(s.ads_provider === "monetag" ? s.ads_monetag_zone : s.ads_block_id)) throw new HttpError(403, "ads_disabled");
  const limit = purpose === "coins" ? s.ads_coins_per_day : purpose === "energy" ? s.ads_energy_per_day : s.spin_enabled ? s.ads_spin_per_day : 0;
  const day = dayKey();
  const nonce = randomToken();
  let err = "";
  await db()
    .ref(`users/${user.id}`)
    .transaction((cur: UserRecord | null) => {
      err = "";
      if (cur === null) return newUser();
      const a = cur.ads && cur.ads.day === day ? cur.ads : { day, coins: 0, energy: 0, spin: 0, srv: cur.ads?.srv || 0 };
      if ((a[purpose] || 0) >= limit) {
        err = "ads_limit";
        return;
      }
      a.nonce = nonce;
      a.ns = Date.now();
      a.p = purpose;
      cur.ads = a;
      return cur;
    });
  if (err) throw new HttpError(409, err);
  res.json({ success: true, nonce });
});
