import { db } from "./firebase";
import { HttpError } from "./auth";
import { COINS_PER_UNIT, MIN_WITHDRAW, UNIT_LABEL, WITHDRAW_METHODS } from "./config";

export interface DepositNet { id: string; name: string; address: string; min: number; note: string }
export interface PayoutNet { id: string; name: string; min: number; fee: number; regex: string }

export interface Settings {
  // ---- growth (সব মান unit-এ; ১ TFUEL = coins_per_tfuel unit) ----
  daily_enabled: boolean;
  daily_rewards: number[]; // দিন ১,২,৩… (শেষে আবার প্রথম থেকে)
  referral_enabled: boolean;
  referrer_bonus: number;
  invitee_bonus: number;
  referral_max: number; // একজন সর্বোচ্চ কতজনের জন্য bonus পাবে
  referral_link: string; // https://t.me/<bot>/<app>
  mine_cap_hours: number; // auto-mining সর্বোচ্চ কত ঘণ্টা জমে (Collect না করলে)
  // ---- TFUEL market (সব ডিফল্টে বন্ধ; admin চালু করবে) ----
  trade_enabled: boolean;
  buy_enabled: boolean;
  sell_enabled: boolean;
  coins_per_tfuel: number; // ১ TFUEL = কত coin
  trade_fee_pct: number; // প্রতিটা trade-এ %
  min_trade_usdt: number;
  max_trade_usdt: number;
  daily_trade_limit_usdt: number; // ০ = সীমা নেই
  price_override: number; // >0 হলে live দামের বদলে এই দাম (USDT)
  deposit_enabled: boolean;
  deposit_networks: DepositNet[];
  payout_enabled: boolean;
  payout_networks: PayoutNet[];

  earn_per_tap: number;
  max_energy: number;
  energy_regen: number;
  maintenance: boolean;
  maintenance_msg: string;
  announcement: { enabled: boolean; text: string; kind: "info" | "warn" | "success" };
  withdraw_enabled: boolean;
  min_withdraw: number;
  withdraw_methods: string[];
  coins_per_unit: number;
  unit_label: string;
  new_user_wait_days: number; // নতুন user এতদিন পর withdraw পারবে (০ = সীমা নেই)
  daily_withdraw_limit: number; // প্রতিদিন সর্বোচ্চ কয়টা অনুরোধ (০ = সীমা নেই)
}

export const DEFAULTS: Settings = {
  daily_enabled: true,
  daily_rewards: [50, 100, 150, 200, 300, 400, 600],
  referral_enabled: true,
  referrer_bonus: 500,
  invitee_bonus: 200,
  referral_max: 100,
  referral_link: process.env.NEXT_PUBLIC_BOT_LINK || "",
  mine_cap_hours: 8,
  trade_enabled: false,
  buy_enabled: true,
  sell_enabled: true,
  coins_per_tfuel: 1000,
  trade_fee_pct: 1,
  min_trade_usdt: 1,
  max_trade_usdt: 500,
  daily_trade_limit_usdt: 1000,
  price_override: 0,
  deposit_enabled: false,
  deposit_networks: [],
  payout_enabled: false,
  payout_networks: [],
  earn_per_tap: 1,
  max_energy: 1000,
  energy_regen: 3,
  maintenance: false,
  maintenance_msg: "We're making improvements. Please check back soon.",
  announcement: { enabled: false, text: "", kind: "info" },
  withdraw_enabled: true,
  min_withdraw: MIN_WITHDRAW,
  withdraw_methods: WITHDRAW_METHODS,
  coins_per_unit: COINS_PER_UNIT,
  unit_label: "USDT",
  new_user_wait_days: 0,
  daily_withdraw_limit: 0,
};

let cache: { at: number; v: Settings } | null = null;

function merge(stored: any): Settings {
  const s = stored && typeof stored === "object" ? stored : {};
  const methods = Array.isArray(s.withdraw_methods)
    ? s.withdraw_methods.map((x: any) => String(x)).filter(Boolean)
    : Object.values(s.withdraw_methods || {}).map((x: any) => String(x));
  const arr = (v: any) => (Array.isArray(v) ? v : Object.values(v || {})).filter(Boolean);
  return {
    ...DEFAULTS,
    ...s,
    daily_rewards: Array.isArray(s.daily_rewards) ? s.daily_rewards : Object.values(s.daily_rewards || {}).length ? Object.values(s.daily_rewards) : DEFAULTS.daily_rewards,
    deposit_networks: arr(s.deposit_networks),
    payout_networks: arr(s.payout_networks),
    announcement: { ...DEFAULTS.announcement, ...(s.announcement || {}) },
    withdraw_methods: methods.length ? methods : s.withdraw_methods === undefined ? DEFAULTS.withdraw_methods : [],
  };
}

export async function getSettings(fresh = false): Promise<Settings> {
  const now = Date.now();
  if (!fresh && cache && now - cache.at < 15000) return cache.v;
  const v = merge((await db().ref("settings").get()).val());
  cache = { at: now, v };
  return v;
}

export function invalidateSettings() {
  cache = null;
}

const num = (v: any, f: string, min: number, max: number, cur: number) => {
  if (v === undefined || v === null || v === "") return cur;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `Invalid ${f}`);
  return n;
};
const str = (v: any, max: number, cur: string) =>
  v === undefined ? cur : String(v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

/** admin-এর পাঠানো মান যাচাই করে বর্তমান settings-এর ওপর বসায় */
export function parseSettings(b: any, cur: Settings): Settings {
  const a = b.announcement || {};
  const kind = ["info", "warn", "success"].includes(a.kind) ? a.kind : cur.announcement.kind;
  let methods = cur.withdraw_methods;
  if (b.withdraw_methods !== undefined) {
    const raw: string[] = Array.isArray(b.withdraw_methods) ? b.withdraw_methods : String(b.withdraw_methods).split(",");
    methods = Array.from(new Set(raw.map((x) => String(x).trim().slice(0, 40)).filter(Boolean))).slice(0, 20);
  }
  const slug = (x: any) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  const txt = (x: any, n: number) => String(x ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
  const n0 = (x: any, f: string, max = 1e9) => {
    const v = Number(x);
    if (!Number.isFinite(v) || v < 0 || v > max) throw new HttpError(400, `Invalid ${f}`);
    return v;
  };
  let dnets = cur.deposit_networks;
  if (b.deposit_networks !== undefined) {
    if (!Array.isArray(b.deposit_networks) || b.deposit_networks.length > 10) throw new HttpError(400, "Invalid deposit networks");
    dnets = b.deposit_networks.map((x: any) => {
      const name = txt(x.name, 30);
      const address = txt(x.address, 100);
      if (!name || address.length < 10) throw new HttpError(400, "Each deposit network needs a name and an address");
      return { id: slug(name), name, address, min: n0(x.min, "deposit min", 1e6), note: txt(x.note, 120) };
    });
    if (new Set(dnets.map((d: DepositNet) => d.id)).size !== dnets.length) throw new HttpError(400, "Duplicate deposit network names");
  }
  let pnets = cur.payout_networks;
  if (b.payout_networks !== undefined) {
    if (!Array.isArray(b.payout_networks) || b.payout_networks.length > 10) throw new HttpError(400, "Invalid payout networks");
    pnets = b.payout_networks.map((x: any) => {
      const name = txt(x.name, 30);
      if (!name) throw new HttpError(400, "Each payout network needs a name");
      const regex = txt(x.regex, 120);
      if (regex) {
        try {
          new RegExp(regex);
        } catch {
          throw new HttpError(400, `Bad address pattern for ${name}`);
        }
      }
      return { id: slug(name), name, min: n0(x.min, "payout min", 1e6), fee: n0(x.fee, "payout fee", 1e6), regex };
    });
    if (new Set(pnets.map((d: PayoutNet) => d.id)).size !== pnets.length) throw new HttpError(400, "Duplicate payout network names");
  }
  let daily = cur.daily_rewards;
  if (b.daily_rewards !== undefined) {
    if (!Array.isArray(b.daily_rewards) || b.daily_rewards.length < 1 || b.daily_rewards.length > 31) throw new HttpError(400, "Invalid daily rewards");
    daily = b.daily_rewards.map((x: any) => Math.floor(n0(x, "daily reward", 1e9)));
  }
  let link = cur.referral_link;
  if (b.referral_link !== undefined) {
    link = txt(b.referral_link, 100).replace(/\/+$/, "");
    if (link && !/^https:\/\/t\.me\/[A-Za-z0-9_]{4,}(\/[A-Za-z0-9_]+)?$/.test(link)) throw new HttpError(400, "Referral link must look like https://t.me/yourbot/app");
  }
  const bool = (k: keyof Settings) => (b[k] === undefined ? (cur as any)[k] : !!b[k]);
  return {
    daily_enabled: bool("daily_enabled"),
    daily_rewards: daily,
    referral_enabled: bool("referral_enabled"),
    referrer_bonus: Math.floor(num(b.referrer_bonus, "referrer_bonus", 0, 1e9, cur.referrer_bonus)),
    invitee_bonus: Math.floor(num(b.invitee_bonus, "invitee_bonus", 0, 1e9, cur.invitee_bonus)),
    referral_max: Math.floor(num(b.referral_max, "referral_max", 0, 100000, cur.referral_max)),
    referral_link: link,
    mine_cap_hours: num(b.mine_cap_hours, "mine_cap_hours", 1, 168, cur.mine_cap_hours),
    trade_enabled: bool("trade_enabled"),
    buy_enabled: bool("buy_enabled"),
    sell_enabled: bool("sell_enabled"),
    coins_per_tfuel: Math.floor(num(b.coins_per_tfuel, "coins_per_tfuel", 1, 1e9, cur.coins_per_tfuel)),
    trade_fee_pct: num(b.trade_fee_pct, "trade_fee_pct", 0, 20, cur.trade_fee_pct),
    min_trade_usdt: num(b.min_trade_usdt, "min_trade_usdt", 0.01, 1e6, cur.min_trade_usdt),
    max_trade_usdt: num(b.max_trade_usdt, "max_trade_usdt", 0.01, 1e7, cur.max_trade_usdt),
    daily_trade_limit_usdt: num(b.daily_trade_limit_usdt, "daily_trade_limit_usdt", 0, 1e7, cur.daily_trade_limit_usdt),
    price_override: num(b.price_override, "price_override", 0, 1e6, cur.price_override),
    deposit_enabled: bool("deposit_enabled"),
    deposit_networks: dnets,
    payout_enabled: bool("payout_enabled"),
    payout_networks: pnets,
    earn_per_tap: Math.floor(num(b.earn_per_tap, "earn_per_tap", 1, 1000, cur.earn_per_tap)),
    max_energy: Math.floor(num(b.max_energy, "max_energy", 10, 100000, cur.max_energy)),
    energy_regen: num(b.energy_regen, "energy_regen", 0, 1000, cur.energy_regen),
    maintenance: b.maintenance === undefined ? cur.maintenance : !!b.maintenance,
    maintenance_msg: str(b.maintenance_msg, 200, cur.maintenance_msg),
    announcement: {
      enabled: a.enabled === undefined ? cur.announcement.enabled : !!a.enabled,
      text: str(a.text, 240, cur.announcement.text),
      kind,
    },
    withdraw_enabled: b.withdraw_enabled === undefined ? cur.withdraw_enabled : !!b.withdraw_enabled,
    min_withdraw: Math.floor(num(b.min_withdraw, "min_withdraw", 1, 1e9, cur.min_withdraw)),
    withdraw_methods: methods,
    coins_per_unit: Math.floor(num(b.coins_per_unit, "coins_per_unit", 1, 1e9, cur.coins_per_unit)),
    unit_label: str(b.unit_label, 10, cur.unit_label) || cur.unit_label,
    new_user_wait_days: Math.floor(num(b.new_user_wait_days, "new_user_wait_days", 0, 365, cur.new_user_wait_days)),
    daily_withdraw_limit: Math.floor(num(b.daily_withdraw_limit, "daily_withdraw_limit", 0, 100, cur.daily_withdraw_limit)),
  };
}
