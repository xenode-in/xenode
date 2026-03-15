import mongoose from "mongoose";
import crypto from "crypto";
import Usage from "@/models/Usage";
import Payment from "@/models/Payment";
import PendingTransaction from "@/models/PendingTransaction";

export const FREE_TIER_BYTES  = 10  * 1024 * 1024 * 1024; // 10 GB
export const PRO_100_BYTES    = 100 * 1024 * 1024 * 1024;
export const PRO_500_BYTES    = 500 * 1024 * 1024 * 1024;
export const PRO_1TB_BYTES    = 1024 * 1024 * 1024 * 1024;

/** Generate a valid MongoDB ObjectId string */
export const makeUserId = () => new mongoose.Types.ObjectId().toString();

/** Generate a CSPRNG txnid matching production format */
export const makeTxnid = () =>
  "TXN" + Date.now() + crypto.randomBytes(8).toString("hex");

/** Compute PayU reverse hash (success callback verification) */
export function computePayuHash(
  fields: {
    salt: string;
    status: string;
    udf5?: string; udf4?: string; udf3?: string; udf2?: string;
    udf1: string;
    email: string;
    firstname: string;
    productinfo: string;
    amount: string;
    txnid: string;
    key: string;
  }
): string {
  const { salt, status, udf1, email, firstname, productinfo, amount, txnid, key } = fields;
  const str = `${salt}|${status}||||||||||${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  return crypto.createHash("sha512").update(str).digest("hex");
}

/** Seed a Usage record */
export async function createUsage(overrides: Partial<{
  userId: string;
  plan: "free" | "pro" | "enterprise";
  totalStorageBytes: number;
  storageLimitBytes: number;
  planPriceINR: number;
  planExpiresAt: Date | null;
  planActivatedAt: Date | null;
}> = {}) {
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
export async function createPayment(overrides: Partial<{
  userId: string;
  txnid: string;
  status: "success" | "pending" | "failed";
  planName: string;
  amount: number;
}> = {}) {
  return Payment.create({
    userId: overrides.userId ?? makeUserId(),
    amount: overrides.amount ?? 149,
    currency: "INR",
    status: overrides.status ?? "success",
    txnid: overrides.txnid ?? makeTxnid(),
    planName: overrides.planName ?? "Basic",
    payuResponse: { status: "success", txnid: overrides.txnid ?? "test" },
  });
}

/** Seed a PendingTransaction record */
export async function createPendingTxn(overrides: Partial<{
  txnid: string;
  userId: string;
  planName: string;
  storageLimitBytes: number;
  planPriceINR: number;
  expiresAt: Date;
}> = {}) {
  const txnid = overrides.txnid ?? makeTxnid();
  return PendingTransaction.create({
    txnid,
    userId: overrides.userId ?? makeUserId(),
    planName: overrides.planName ?? "Basic",
    storageLimitBytes: overrides.storageLimitBytes ?? PRO_100_BYTES,
    planPriceINR: overrides.planPriceINR ?? 149,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 3600_000),
    paymentMethod: "direct",
    expectedAmount: overrides.planPriceINR ?? 149,
  });
}


