import { authenticate } from "@/lib/auth";
import { route } from "@/lib/api";
import { getChart, getKlines, INTERVALS, Interval, Range } from "@/lib/market";

export default route(async (req, res) => {
  authenticate(req);
  const iv = String(req.body?.interval || "");
  if (iv in INTERVALS) return void res.json({ success: true, ...(await getKlines(iv as Interval)) });
  const r = String(req.body?.range || "1d") as Range;
  const c = await getChart(["1d", "7d", "30d", "90d", "1y"].includes(r) ? r : "1d");
  res.json({ success: true, ...c });
});
