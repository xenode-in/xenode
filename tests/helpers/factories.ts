import mongoose from "mongoose";
import Usage from "@/models/Usage";
import Payment from "@/models/Payment";

export const FREE_TIER_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
export const PRO_100_BYTES = 100 * 1024 * 1024 * 1024;
export const PRO_500_BYTES = 500 * 1024 * 1024 * 1024;
export const PRO_1TB_BYTES = 1024 * 1024 * 1024 * 1024;

/** Generate a valid MongoDB ObjectId string */
export const makeUserId = () => new mongoose.Types.ObjectId().toString();

/** Seed a Usage record */
export async function createUsage(
  overrides: Partial<{
    userId: string;
    plan: "free" | "pro" | "enterprise";
    totalStorageBytes: number;
    storageLimitBytes: number;
    planPriceINR: number;
    planExpiresAt: Date | null;
    planActivatedAt: Date | null;
  }> = {},
) {
  const userId = overrides.userId ?? makeUserId();
  return Usage.create({
    userId,
    plan: "free",
    totalStorageBytes: 0,
    storageLimitBytes: FREE_TIER_BYTES,
    planPriceINR: 0,
    planExpiresAt: null,
    planActivatedAt: null,
    ...overrides,
  });
}

/** Seed a completed Payment record (for idempotency tests) */
export async function createPayment(
  overrides: Partial<{
    userId: string;
    txnid: string;
    status: "success" | "pending" | "failed";
    planName: string;
    amount: number;
  }> = {},
) {
  return Payment.create({
    userId: overrides.userId ?? makeUserId(),
    amount: overrides.amount ?? 149,
    currency: "INR",
    status: overrides.status ?? "success",
    txnid: overrides.txnid ?? `TXN${Date.now()}${Math.random().toString(36).slice(2, 10)}`,
    planName: overrides.planName ?? "Basic",
    gatewayResponse: { status: "success" },
    billingCycle: "monthly",
    subscriptionStartDate: new Date(),
    subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
}
