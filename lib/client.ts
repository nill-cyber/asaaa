// শুধু browser-এ চলে
declare global {
  interface Window {
    Telegram?: { WebApp?: any };
  }
}

export function tg() {
  return typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
}

export async function api<T = any>(path: string, body: Record<string, any> = {}): Promise<T> {
  const initData = tg()?.initData || "";
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${initData}` };
  try {
    const adm = typeof window !== "undefined" ? sessionStorage.getItem("adm") : null;
    if (adm) headers["x-admin-token"] = adm;
  } catch {}
  const r = await fetch(`/api/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.success === false) {
    const err: any = new Error(data.error || `Error ${r.status}`);
    err.data = data; // attempts_left, retry_at, min ইত্যাদি
    throw err;
  }
  return data as T;
}

export function openLink(url: string) {
  const w = tg();
  if (w?.openLink) w.openLink(url);
  else window.open(url, "_blank");
}

export function openTgLink(url: string) {
  const w = tg();
  if (w?.openTelegramLink && /^https:\/\/t\.me\//.test(url)) w.openTelegramLink(url);
  else openLink(url);
}

/** 1 TFUEL = cpt coin; দেখানো হয় সবসময় TFUEL (দশমিকসহ) ও USDT মূল্য */
export const tfDecimals = (cpt: number) => Math.min(6, Math.max(0, Math.round(Math.log10(Math.max(1, cpt)))));
export function fmtTf(coins: number, cpt: number): string {
  const d = tfDecimals(cpt);
  return (coins / cpt).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fmtUsd(v: number): string {
  if (!v) return "$0.00";
  if (v < 0.01) return "<$0.01";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ERR: Record<string, string> = {
  no_site_available: "No article site is available right now. Please try again later.",
  cooldown: "This site isn't ready yet. Try another one or come back later.",
  no_active_run: "Start an article site first.",
  finish_articles_first: "Read all the articles in order to get your code.",
  code_expired: "That code has expired. Go to the last article and get a new one.",
  wrong_code: "Wrong code. Please check and try again.",
  locked: "Too many wrong attempts. Please start the site again.",
  already_claimed: "This code has already been used.",
  code_must_be_6_digits: "Enter the 6-digit code.",
  below_minimum: "Amount is below the minimum.",
  insufficient: "You don't have enough TFUEL.",
  bad_method: "Choose a withdrawal method.",
  bad_account: "Enter your account or wallet address.",
  verify_unavailable: "We couldn't check this right now. Please try again in a little while.",
  not_joined: "We couldn't confirm you've joined yet. Join the channel, then tap Verify again.",
  account_banned: "Your account has been suspended.",
  maintenance: "We're making improvements. Please check back soon.",
  withdraw_disabled: "Withdrawals are temporarily paused.",
  too_new: "New accounts can withdraw after a short waiting period.",
  daily_limit: "You've reached today's withdrawal limit.",
  trade_disabled: "Trading is currently paused.",
  trade_side_disabled: "This type of trade is currently unavailable.",
  price_unavailable: "Live price is temporarily unavailable. Please try again shortly.",
  price_changed: "The price just moved. Please review and try again.",
  bad_amount: "Enter a valid amount.",
  below_min_trade: "Amount is below the minimum per trade.",
  above_max_trade: "Amount is above the maximum per trade.",
  daily_trade_limit: "You've reached today's trading limit.",
  insufficient_usdt: "You don't have enough USDT.",
  deposit_disabled: "Deposits are temporarily unavailable.",
  bad_network: "Choose a network.",
  bad_txid: "That transaction ID doesn't look right.",
  below_min_deposit: "Amount is below the minimum deposit for this network.",
  txid_used: "This transaction ID has already been submitted.",
  need_intent: "Tap “Get exact amount” first, then send exactly that amount.",
  try_again: "Please try again in a moment.",
  boost_blocked: "You can't switch plans right now (a plan is already queued, or your current one is permanent).",
  too_many_pending: "You have too many deposits waiting for review.",
  bad_address: "That wallet address isn't valid for this network.",
  below_min_usdt: "Amount is below the minimum withdrawal.",
  withdraw_failed: "Something went wrong. Your balance was not changed.",
  boost_active: "This boost is already active.",
  plan_unavailable: "This plan is no longer available.",
  nothing_to_collect: "Nothing to collect yet.",
  bad_stake_amount: "Amount is outside this plan's limits.",
  pool_full: "This staking plan is full right now.",
  too_many_stakes: "You have too many active stakes.",
  stake_not_ready: "This stake hasn't matured yet.",
  already_claimed_today: "You've already claimed today's reward.",
  daily_disabled: "Daily rewards are paused.",
  promo_invalid: "That promo code isn't valid.",
  promo_expired: "This promo code has expired.",
  promo_exhausted: "This promo code has been fully used.",
  promo_used: "You've already used this promo code.",
  no_spins: "No spins left right now. Watch an ad or come back tomorrow.",
  spin_disabled: "Lucky Spin is paused.",
  ads_disabled: "Ads are unavailable right now.",
  ads_limit: "You've reached today's limit for this.",
  ad_invalid: "That ad couldn't be verified. Please try again.",
  ad_too_fast: "Please watch the full ad.",
  ad_unverified: "We couldn't verify the ad yet. Try again in a moment.",
  alerts_full: "You've reached the alert limit. Remove one first.",
  alert_too_close: "Pick a price a little further from the current price.",
  bad_price: "Enter a valid price.",
  orders_full: "You've reached the open order limit. Cancel one first.",
  orders_disabled: "Limit orders are unavailable right now.",
  limit_wrong_side: "Sell limits must be above the current price; buy limits below it.",
  order_not_open: "This order is no longer open.",
  "Too fast": "Slow down a little.",
  "Not enough energy": "Out of energy. It refills over time.",
  "Too many requests": "Too many requests. Please wait a moment.",
  "Already claimed": "You've already claimed this reward.",
  "Too early": "Please wait a bit longer.",
  "Session expired, reopen the app": "Session expired. Please reopen the app.",
};

/** error code → friendly English message */
export function errText(e: any): string {
  return ERR[e?.message] || "Something went wrong. Please try again.";
}
