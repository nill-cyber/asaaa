import crypto from "crypto";
import type { NextApiRequest } from "next";
import { verifyAdminToken } from "./crypto";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface TgUser {
  id: string;
  first_name?: string;
  username?: string;
}

/**
 * Authorization: Bearer <initData> যাচাই করে।
 * client-এর পাঠানো userId কখনো বিশ্বাস করা হয় না, শুধু signed initData থেকে নেওয়া হয়।
 * maxAgeSec: সাধারণ endpoint-এ ২৪ ঘণ্টা, টাকা-সংক্রান্ত endpoint-এ ১ ঘণ্টা।
 */
export function authenticate(req: NextApiRequest, maxAgeSec = 24 * 3600): TgUser {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) throw new HttpError(401, "Missing auth");
  const initData = header.slice(7);

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) throw new HttpError(500, "Server misconfigured");

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new HttpError(401, "Invalid initData");
  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, "Bad signature");
  }

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) {
    throw new HttpError(401, "Session expired, reopen the app");
  }

  let user: any;
  try {
    user = JSON.parse(params.get("user") || "");
  } catch {
    throw new HttpError(401, "No user");
  }
  if (!user?.id) throw new HttpError(401, "No user");

  return { id: String(user.id), first_name: user.first_name, username: user.username };
}

export function requireAdmin(req: NextApiRequest): TgUser {
  // ব্রাউজার থেকে পাসওয়ার্ড দিয়ে ঢুকলে (admin-login)
  const t = req.headers["x-admin-token"];
  if (typeof t === "string" && verifyAdminToken(t)) return { id: "admin" };

  // Telegram-এর ভেতর থেকে ঢুকলে (ADMIN_TELEGRAM_IDS)
  const user = authenticate(req, 3600);
  const admins = (process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((s) => s.trim());
  if (!admins.includes(user.id)) throw new HttpError(403, "Forbidden");
  return user;
}
