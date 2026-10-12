import { authenticate, HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { db } from "@/lib/firebase";
import { earn, activity, lbAdd } from "@/lib/wallet";
import { ensureUser, newUser, UserRecord } from "@/lib/user";

/** Promo code redeem — প্রতি user একবার; মোট ব্যবহার ও মেয়াদ admin ঠিক করে */
export default route(async (req, res) => {
  const user = authenticate(req);
  await rateLimit(user.id, "promo", 8);
  await ensureUser(user);
  const code = String(req.body?.code || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw new HttpError(400, "promo_invalid");
  const now = Date.now();
  let err = "";
  let coins = 0;
  await db()
    .ref(`promo/${code}`)
    .transaction((p: any) => {
      err = "";
      if (p === null) return p; // Admin SDK-এর প্রথম run (cache নেই)
      if (!p.active) err = "promo_invalid";
      else if (p.exp && p.exp < now) err = "promo_expired";
      else if (p.max > 0 && (p.used || 0) >= p.max) err = "promo_exhausted";
      if (err) return;
      coins = Number(p.coins) || 0;
      p.used = (p.used || 0) + 1;
      return p;
    });
  if (!coins && !err) err = "promo_invalid";
  if (err) throw new HttpError(409, err);

  let dup = false;
  let balance = 0;
  await db()
    .ref(`users/${user.id}`)
    .transaction((cur: UserRecord | null) => {
      dup = false;
      if (cur === null) return newUser();
      if (cur.promos?.[code]) {
        dup = true;
        return;
      }
      cur.promos = cur.promos || {};
      cur.promos[code] = now;
      cur.balance += coins;
      earn(cur, "promo", coins);
      balance = cur.balance;
      return cur;
    });
  if (dup) {
    await db().ref(`promo/${code}/used`).transaction((n: number | null) => Math.max(0, (n || 0) - 1)); // ব্যবহার ফেরত
    throw new HttpError(409, "promo_used");
  }
  await lbAdd(user.id, coins);
  await activity(user.id, "promo", { coins, note: code });
  res.json({ success: true, coins, balance });
});
