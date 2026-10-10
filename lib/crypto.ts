import crypto from "crypto";

function secret(): string {
  const s = process.env.SERVER_SECRET;
  if (!s || s.length < 16) throw new Error("SERVER_SECRET missing or too short");
  return s;
}

export const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

/** ৬ ডিজিটের কোড hash: প্লেইন SHA-256 নয়, secret সহ HMAC (DB leak হলেও কোড বের করা যাবে না) */
export const hmacCode = (code: string, uid: string, siteId: string) =>
  crypto.createHmac("sha256", secret()).update(`${uid}:${siteId}:${code}`).digest("hex");

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const randomCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
export const randomKey = () => "sk_" + crypto.randomBytes(24).toString("hex");
export const randomId = () => crypto.randomBytes(8).toString("hex");

const b64 = (b: Buffer) => b.toString("base64url");

export interface VisitPayload {
  uid: string;
  siteId: string;
  ts: number;
  nonce: string;
}

/** visit token = base64url(payload).signature */
export function signVisitToken(p: VisitPayload): string {
  const body = b64(Buffer.from(JSON.stringify(p)));
  const sig = b64(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyVisitToken(token: string): VisitPayload | null {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;
  const expected = b64(crypto.createHmac("sha256", secret()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
}

// ---------- আর্টিকেল-চেইনের জন্য ----------

/** চেইনের ৬ ডিজিট কোডের hash: run token + কোড + SERVER_SECRET (DB leak হলেও কোড বের করা যাবে না) */
export const chainCodeHash = (code: string, token: string) =>
  crypto.createHmac("sha256", secret()).update(`code:${token}:${code}`).digest("hex");

/** run-এর গোপন টোকেন (৩২ hex) */
export const randomToken = () => crypto.randomBytes(16).toString("hex");

/** সময় অনুযায়ী সাজানো যায় এমন ID (admin তালিকার জন্য) */
export const sortableId = () =>
  new Date().toISOString().replace(/\D/g, "").slice(0, 14) + crypto.randomBytes(4).toString("hex");

// ---------- ব্রাউজার থেকে Admin লগইন (পাসওয়ার্ড → সই করা টোকেন) ----------

const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // ১২ ঘণ্টা

export function signAdminToken(): string {
  const body = Buffer.from(JSON.stringify({ exp: Date.now() + ADMIN_TOKEN_TTL_MS })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update("admin:" + body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAdminToken(token: string): boolean {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return false;
  const expected = crypto.createHmac("sha256", secret()).update("admin:" + body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()).exp > Date.now();
  } catch {
    return false;
  }
}

/** পাসওয়ার্ড তুলনা (দৈর্ঘ্য না ফাঁস করে, timing-safe) */
export function passwordMatches(input: string, real: string): boolean {
  const h = (v: string) => crypto.createHash("sha256").update(v).digest();
  return crypto.timingSafeEqual(h(input), h(real));
}
