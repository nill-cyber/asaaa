import crypto from "crypto";

function key(): Buffer {
  const s = process.env.SERVER_SECRET;
  if (!s || s.length < 16) throw new Error("SERVER_SECRET missing or too short");
  return crypto.createHash("sha256").update("secretbox:" + s).digest();
}

/** AES-256-GCM: DB-তে রাখা গোপন মান (যেমন Binance secret) — DB leak হলেও SERVER_SECRET ছাড়া পড়া যায় না */
export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function open(box: string): string | null {
  try {
    const [iv, tag, enc] = box.split(".").map((p) => Buffer.from(p, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
