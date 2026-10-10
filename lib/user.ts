import { db } from "./firebase";

export const MAX_BATCH_LIMIT = 50; // এক request-এ সর্বোচ্চ tap
export const MAX_TAPS_PER_SEC = 15; // সর্বোচ্চ tap/sec
export const MAX_AUTH_AGE_MONEY = 3600; // টাকা-সংক্রান্ত endpoint-এ initData ১ ঘণ্টা
export const MAX_FAILED_ATTEMPTS = 3;
export const VISIT_TOKEN_TTL_MS = 15 * 60 * 1000;

export interface UserRecord {
  balance: number;
  energy: number;
  max_energy: number;
  energy_regen_rate: number;
  earn_per_tap: number;
  last_energy_calc_time: number;
  last_tap_time: number;
  completed_tasks?: Record<string, { claimed?: boolean; claimed_at: number }>;
  pending_tasks?: Record<string, { started_at: number }>;
  active_codes?: Record<
    string,
    { code_hash: string; created_at: number; expires_at: number; failed_attempts: number }
  >;
  used_tokens?: Record<string, number>;
  active_run?: string;
  withdrawals?: Record<string, { amount: number; method: string; status: string; created_at: number }>;
}

export function newUser(now = Date.now()): UserRecord {
  return {
    balance: 0,
    energy: 1000,
    max_energy: 1000,
    energy_regen_rate: 3,
    earn_per_tap: 1,
    last_energy_calc_time: now,
    last_tap_time: 0,
  };
}

export function currentEnergy(u: UserRecord, now = Date.now()): number {
  const deltaSec = Math.max(0, (now - u.last_energy_calc_time) / 1000);
  return Math.min(u.max_energy, u.energy + deltaSec * u.energy_regen_rate);
}

/** নতুন user হলে তৈরি করে। প্রতি request-এ একবার ডাকুন। */
export async function ensureUser(uid: string): Promise<void> {
  await db()
    .ref(`users/${uid}`)
    .transaction((cur) => (cur === null ? newUser() : undefined));
}
