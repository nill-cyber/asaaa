// সব মান Vercel-এর Environment Variables থেকে বদলানো যায়; না দিলে ডিফল্ট

const int = (v: string | undefined, d: number) => {
  const n = parseInt(v || "", 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const MIN_WITHDRAW = int(process.env.MIN_WITHDRAW, 10000); // কমপক্ষে কত coin
export const WITHDRAW_METHODS = (process.env.WITHDRAW_METHODS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
export const COINS_PER_UNIT = int(process.env.COINS_PER_UNIT, 1000); // ১০০০ coin = ১ ইউনিট (শুধু দেখানোর জন্য)
export const UNIT_LABEL = process.env.UNIT_LABEL || "BDT";
export const RUN_TTL_MIN = int(process.env.RUN_TTL_MIN, 60); // একটা চেইন শেষ করার সময়
export const CODE_TTL_MIN = int(process.env.CODE_TTL_MIN, 10); // কোড কতক্ষণ বৈধ
