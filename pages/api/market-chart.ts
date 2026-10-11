import { authenticate } from "@/lib/auth";
import { route } from "@/lib/api";
import { getChart, Range } from "@/lib/market";

export default route(async (req, res) => {
  authenticate(req);
  const r = String(req.body?.range || "1d") as Range;
  const c = await getChart(["1d", "7d", "30d"].includes(r) ? r : "1d");
  res.json({ success: true, ...c });
});
