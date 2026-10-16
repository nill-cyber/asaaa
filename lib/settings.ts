import { db } from "./firebase";
import { HttpError } from "./auth";
import { COINS_PER_UNIT, MIN_WITHDRAW, UNIT_LABEL, WITHDRAW_METHODS } from "./config";

export interface DepositNet { id: string; name: string; address: string; min: number; note: string; binance_network?: string }
export interface PayoutNet { id: string; name: string; min: number; fee: number; regex: string }

export interface Settings {
  // ---- growth (সব মান unit-এ; ১ TFUEL = coins_per_tfuel unit) ----
  daily_enabled: boolean;
  daily_rewards: number[]; // দিন ১,২,৩… (শেষে আবার প্রথম থেকে)
  referral_enabled: boolean;
  referrer_bonus: number;
  invitee_bonus: number;
  referral_commission_pct: number; // রেফারি-র আয়ের % রেফারার পায় (stake/trade বাদে); ০ = বন্ধ
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
  binance_auto: boolean; // Binance deposit history মিলিয়ে নিজে approve
  binance_auto_max: number; // এর বেশি হলে verify হয় কিন্তু admin approve করে (USDT)
  binance_id_enabled: boolean; // Binance ID (internal / Pay transfer) দিয়ে deposit
  binance_id: string; // তোমার Binance Pay ID / UID
  binance_id_min: number;
  stars_enabled: boolean; // Telegram Stars দিয়ে deposit
  stars_per_usdt: number; // ১ USDT = কত Stars
  stars_min_usdt: number;
  stars_max_usdt: number;
  payout_enabled: boolean;
  payout_networks: PayoutNet[];

  earn_per_tap: number;
  max_energy: number;
  energy_regen: number; // প্রতি সেকেন্ডে ধীরে ধীরে ভরা (০ = শুধু নিচের "খালি হলে পুরো ভরা")
  energy_cost: number; // প্রতি tap-এ কত energy খরচ
  empty_refill_hours: number; // energy খালি হলে এত ঘণ্টা পর পুরো ভরে (০ = বন্ধ)
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
  // ---- engagement ----
  notify_enabled: boolean; // bot-এর মাধ্যমে user-কে বার্তা
  orders_enabled: boolean; // limit / stop order
  max_open_orders: number;
  max_alerts: number;
  spin_enabled: boolean;
  spin_prizes: { coins: number; weight: number }[];
  spin_free_per_day: number;
  lb_enabled: boolean;
  lb_prizes: number[]; // সাপ্তাহিক top N-এর prize (coin)
  ads_enabled: boolean;
  ads_block_id: string; // Adsgram block id
  ads_provider: "monetag" | "adsgram";
  ads_monetag_zone: string; // Monetag zone id (যেমন 12010944)
  ads_monetag_format: "interstitial" | "popup"; // reward-এর বিজ্ঞাপনের ধরন
  ads_inapp: boolean; // Monetag in-app interstitial (নিজে নিজে মাঝেমধ্যে)
  ads_coins: number; // একটা ad দেখলে bonus
  ads_coins_per_day: number;
  ads_energy_per_day: number; // ad দেখে energy refill দিনে কতবার
  ads_spin_per_day: number; // ad দেখে extra spin দিনে কতবার
}

export const DEFAULTS: Settings = {
  daily_enabled: true,
  daily_rewards: [50, 100, 150, 200, 300, 400, 600],
  referral_enabled: true,
  referrer_bonus: 500,
  invitee_bonus: 200,
  referral_commission_pct: 3,
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
  binance_auto: false,
  binance_auto_max: 200,
  binance_id_enabled: false,
  binance_id: "",
  binance_id_min: 1,
  stars_enabled: false,
  stars_per_usdt: 77,
  stars_min_usdt: 1,
  stars_max_usdt: 100,
  payout_enabled: false,
  payout_networks: [],
  earn_per_tap: 1,
  max_energy: 1000,
  energy_regen: 0,
  energy_cost: 1.5,
  empty_refill_hours: 3,
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
  notify_enabled: true,
  orders_enabled: true,
  max_open_orders: 5,
  max_alerts: 5,
  spin_enabled: true,
  spin_prizes: [
    { coins: 20, weight: 40 },
    { coins: 50, weight: 28 },
    { coins: 100, weight: 15 },
    { coins: 200, weight: 9 },
    { coins: 500, weight: 5 },
    { coins: 1000, weight: 2.5 },
    { coins: 5000, weight: 0.5 },
  ],
  spin_free_per_day: 1,
  lb_enabled: true,
  lb_prizes: [5000, 3000, 2000, 1000, 1000],
  ads_enabled: false,
  ads_block_id: "",
  ads_provider: "monetag",
  ads_monetag_zone: "12010944",
  ads_monetag_format: "interstitial",
  ads_inapp: false,
  ads_coins: 200,
  ads_coins_per_day: 5,
  ads_energy_per_day: 2,
  ads_spin_per_day: 3,
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
    spin_prizes: arr(s.spin_prizes).length ? arr(s.spin_prizes) : DEFAULTS.spin_prizes,
    lb_prizes: s.lb_prizes === undefined ? DEFAULTS.lb_prizes : arr(s.lb_prizes).map(Number),
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
      const bn = txt(x.binance_network, 12).toUpperCase();
      if (bn && !/^[A-Z0-9]{2,12}$/.test(bn)) throw new HttpError(400, "Binance network code looks wrong (e.g. TRX, BSC, ETH)");
      return { id: slug(name), name, address, min: n0(x.min, "deposit min", 1e6), note: txt(x.note, 120), binance_network: bn };
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
  let spin = cur.spin_prizes;
  if (b.spin_prizes !== undefined) {
    if (!Array.isArray(b.spin_prizes) || b.spin_prizes.length < 2 || b.spin_prizes.length > 12) throw new HttpError(400, "Spin needs 2 to 12 prizes");
    spin = b.spin_prizes.map((x: any) => {
      const coins = Math.floor(Number(x.coins));
      const weight = Number(x.weight);
      if (!Number.isFinite(coins) || coins < 1 || coins > 1e9 || !Number.isFinite(weight) || weight <= 0 || weight > 1e6) throw new HttpError(400, "Invalid spin prize");
      return { coins, weight };
    });
  }
  let lbp = cur.lb_prizes;
  if (b.lb_prizes !== undefined) {
    if (!Array.isArray(b.lb_prizes) || b.lb_prizes.length > 20) throw new HttpError(400, "Invalid leaderboard prizes");
    lbp = b.lb_prizes.map((x: any) => Math.floor(n0(x, "leaderboard prize", 1e9)));
  }
  const bool = (k: keyof Settings) => (b[k] === undefined ? (cur as any)[k] : !!b[k]);
  return {
    daily_enabled: bool("daily_enabled"),
    daily_rewards: daily,
    referral_enabled: bool("referral_enabled"),
    referrer_bonus: Math.floor(num(b.referrer_bonus, "referrer_bonus", 0, 1e9, cur.referrer_bonus)),
    invitee_bonus: Math.floor(num(b.invitee_bonus, "invitee_bonus", 0, 1e9, cur.invitee_bonus)),
    referral_max: Math.floor(num(b.referral_max, "referral_max", 0, 100000, cur.referral_max)),
    referral_commission_pct: num(b.referral_commission_pct, "referral_commission_pct", 0, 50, cur.referral_commission_pct),
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
    binance_auto: bool("binance_auto"),
    binance_auto_max: num(b.binance_auto_max, "binance_auto_max", 0, 1e6, cur.binance_auto_max),
    binance_id_enabled: bool("binance_id_enabled"),
    binance_id: (() => { const v = str(b.binance_id, 20, cur.binance_id); if (v && !/^\d{5,20}$/.test(v)) throw new HttpError(400, "Binance ID must be digits only"); return v; })(),
    binance_id_min: num(b.binance_id_min, "binance_id_min", 0.01, 1e6, cur.binance_id_min),
    stars_enabled: bool("stars_enabled"),
    stars_per_usdt: num(b.stars_per_usdt, "stars_per_usdt", 1, 100000, cur.stars_per_usdt),
    stars_min_usdt: num(b.stars_min_usdt, "stars_min_usdt", 0.01, 1e5, cur.stars_min_usdt),
    stars_max_usdt: num(b.stars_max_usdt, "stars_max_usdt", 0.01, 1e5, cur.stars_max_usdt),
    payout_enabled: bool("payout_enabled"),
    payout_networks: pnets,
    earn_per_tap: Math.floor(num(b.earn_per_tap, "earn_per_tap", 1, 1000, cur.earn_per_tap)),
    max_energy: Math.floor(num(b.max_energy, "max_energy", 10, 100000, cur.max_energy)),
    energy_regen: num(b.energy_regen, "energy_regen", 0, 1000, cur.energy_regen),
    energy_cost: num(b.energy_cost, "energy_cost", 0.1, 100, cur.energy_cost),
    empty_refill_hours: num(b.empty_refill_hours, "empty_refill_hours", 0, 72, cur.empty_refill_hours),
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
    notify_enabled: bool("notify_enabled"),
    orders_enabled: bool("orders_enabled"),
    max_open_orders: Math.floor(num(b.max_open_orders, "max_open_orders", 0, 50, cur.max_open_orders)),
    max_alerts: Math.floor(num(b.max_alerts, "max_alerts", 0, 50, cur.max_alerts)),
    spin_enabled: bool("spin_enabled"),
    spin_prizes: spin,
    spin_free_per_day: Math.floor(num(b.spin_free_per_day, "spin_free_per_day", 0, 50, cur.spin_free_per_day)),
    lb_enabled: bool("lb_enabled"),
    lb_prizes: lbp,
    ads_enabled: bool("ads_enabled"),
    ads_block_id: str(b.ads_block_id, 40, cur.ads_block_id),
    ads_provider: ["monetag", "adsgram"].includes(b.ads_provider) ? b.ads_provider : cur.ads_provider,
    ads_monetag_zone: (() => { const z = str(b.ads_monetag_zone, 12, cur.ads_monetag_zone); if (z && !/^\d{4,12}$/.test(z)) throw new HttpError(400, "Monetag zone must be digits only"); return z; })(),
    ads_monetag_format: ["interstitial", "popup"].includes(b.ads_monetag_format) ? b.ads_monetag_format : cur.ads_monetag_format,
    ads_inapp: bool("ads_inapp"),
    ads_coins: Math.floor(num(b.ads_coins, "ads_coins", 0, 1e9, cur.ads_coins)),
    ads_coins_per_day: Math.floor(num(b.ads_coins_per_day, "ads_coins_per_day", 0, 100, cur.ads_coins_per_day)),
    ads_energy_per_day: Math.floor(num(b.ads_energy_per_day, "ads_energy_per_day", 0, 100, cur.ads_energy_per_day)),
    ads_spin_per_day: Math.floor(num(b.ads_spin_per_day, "ads_spin_per_day", 0, 100, cur.ads_spin_per_day)),
  };
}
