import { HttpError } from "@/lib/auth";
import { route, rateLimit } from "@/lib/api";
import { passwordMatches, signAdminToken } from "@/lib/crypto";

/** ব্রাউজার থেকে Admin লগইন: ADMIN_PASSWORD মিললে ১২ ঘণ্টার সই করা টোকেন দেয় */
export default route(async (req, res) => {
  const real = process.env.ADMIN_PASSWORD;
  if (!real || real.length < 8) throw new HttpError(403, "ADMIN_PASSWORD সেট করা নেই (কমপক্ষে ৮ অক্ষর)");

  // IP ধরে চেষ্টার সীমা (প্রতি মিনিটে ৮)
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  await rateLimit("ip_" + ip.replace(/[^\w]/g, "_"), "admin-login", 8);

  if (!passwordMatches(String(req.body?.password || ""), real)) {
    await new Promise((r) => setTimeout(r, 800));
    throw new HttpError(401, "পাসওয়ার্ড ভুল");
  }
  res.json({ success: true, token: signAdminToken() });
});
