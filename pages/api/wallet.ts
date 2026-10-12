import { authenticate } from "@/lib/auth";
import { route } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ensureUser, pendingMining } from "@/lib/user";
import { peekPrice, fromU } from "@/lib/market";

const BUCKET = 6 * 3600000; // portfolio ছবি ৬ ঘণ্টায় একটা

/** Profile = exchanger-style wallet: TFUEL + USDT balance, কোথা থেকে পেল, সাম্প্রতিক কার্যকলাপ */
export default route(async (req, res) => {
  const user = authenticate(req);
  const { u, settings: s } = await ensureUser(user, { soft: true });
  const now = Date.now();
  const price = await peekPrice(s);
  const cpt = s.coins_per_tfuel;

  const locked = Object.values(u.stakes || {})
    .filter((k) => k.status === "active")
    .reduce((a, k) => a + k.amount, 0);
  const mining = pendingMining(u, s.mine_cap_hours, now).amount;

  const actSnap = await db().ref(`activity/${user.id}`).orderByKey().limitToLast(30).get();
  const act = Object.entries((actSnap.val() || {}) as Record<string, any>)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 30)
    .map(([id, a]) => ({ id, t: a.t, c: a.c || 0, u: fromU(a.u || 0), n: a.n || "", at: a.at }));

  // ---- portfolio: মোট মূল্যের ছবি (wallet খুললে হালনাগাদ) ----
  const tfuelNow = (u.balance / cpt) * (price || 0);
  const totalNow = tfuelNow + fromU(u.usdt_u || 0);
  const bk = Math.floor(now / BUCKET);
  if (price) {
    await db().ref(`portfolio/${user.id}/${bk}`).set(Math.round(totalNow * 10000) / 10000).catch(() => {});
    if (Math.random() < 0.05) {
      const old = ((await db().ref(`portfolio/${user.id}`).orderByKey().endAt(String(bk - 130)).limitToFirst(50).get()).val() || {}) as Record<string, number>;
      for (const k of Object.keys(old)) await db().ref(`portfolio/${user.id}/${k}`).remove().catch(() => {});
    }
  }
  const pv = ((await db().ref(`portfolio/${user.id}`).orderByKey().limitToLast(120).get()).val() || {}) as Record<string, number>;
  const portfolio = Object.entries(pv)
    .map(([k, v]) => [Number(k) * BUCKET, Number(v)])
    .sort((a, b) => a[0] - b[0]);

  const tot = u.usdt_tot || {};
  res.json({
    success: true,
    price,
    cpt,
    tfuel: {
      balance: u.balance,
      locked,
      mining,
      earn: u.earn || {},
      spent: u.spent || {},
    },
    usdt: {
      balance: fromU(u.usdt_u || 0),
      tot: {
        deposited: fromU(tot.deposited || 0),
        sold: fromU(tot.sold || 0),
        bought: fromU(tot.bought || 0),
        withdrawn: fromU(tot.withdrawn || 0),
        adjusted: fromU(tot.adjusted || 0),
      },
    },
    activity: act,
    portfolio,
  });
});
