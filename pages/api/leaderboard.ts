import { authenticate } from "@/lib/auth";
import { route } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ensureUser } from "@/lib/user";
import { dayKey } from "@/lib/log";
import { weekIndex, weekStart } from "@/lib/wallet";
import { top, names } from "@/lib/leaderboard";

/** Leaderboard: board = "d" (আজ) | "w" (এই সপ্তাহ) | "all" */
export default route(async (req, res) => {
  try {
  const user = authenticate(req);
  const { settings: s } = await ensureUser(user, { soft: true });
  if (!s.lb_enabled) return void res.json({ success: true, enabled: false });
  const b = String(req.body?.board || "w");
  const now = Date.now();
  const key = b === "d" ? `d_${dayKey(now)}` : b === "all" ? "all" : `w_${weekIndex(now)}`;
  const t = await top(key, 50);
  const nm = await names(t.slice(0, 20).map((x) => x.id));
  const mine = Number((await db().ref(`lb/${key}/${user.id}`).get()).val()) || 0;
  const pos = t.findIndex((x) => x.id === user.id);
  res.json({
    success: true,
    enabled: true,
    board: b === "d" || b === "all" ? b : "w",
    coinsPerTfuel: s.coins_per_tfuel,
    list: t.slice(0, 20).map((x, i) => ({ rank: i + 1, name: nm[x.id], v: x.v, me: x.id === user.id })),
    me: { v: mine, rank: pos >= 0 ? pos + 1 : null },
    prizes: b === "w" ? s.lb_prizes : [],
    endsAt: b === "w" ? weekStart(weekIndex(now) + 1) : b === "d" ? (Math.floor(now / 86400000) + 1) * 86400000 : null,
  });
  } catch (e: any) {
    if (e?.status) throw e; // HttpError (auth ইত্যাদি) আগের মতো
    console.error("leaderboard failed", e);
    res.status(500).json({ success: false, error: "lb_failed", detail: String(e?.message || e).slice(0, 160) });
  }
});
