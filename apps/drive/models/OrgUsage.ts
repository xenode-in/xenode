import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Org-level usage & plan state — the organization analogue of `Usage`.
 *
 * A SEPARATE model (not an extension of `Usage`, whose `userId` is unique and
 * whose expiry cron sweeps rows by `plan != free`). Keeps the personal state
 * machine pristine. Only `syncOrgSubscriptionState` writes plan/limit/seats;
 * storage bytes are mutated only by the org metering helpers.
 *
 * BILLING_SECURITY: this model carries bytes + seats + plan only — never keys or
 * file metadata.
 */

export const ORG_FREE_TIER_LIMIT_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
export const ORG_FREE_SEATS = 3;

export interface IOrgTeamQuota {
  teamId: string;
  limitBytes: number;
}

export interface IOrgUsage extends Document {
  _id: mongoose.Types.ObjectId;
  orgId: string;
  /** Billing account id — always `org:{orgId}`. Mirrors Subscription.accountId. */
  accountId: string;
  totalStorageBytes: number;
  totalObjects: number;
  storageLimitBytes: number | null; // null = unlimited (enterprise)
  /** Purchased seats (Razorpay subscription quantity). */
  seats: number;
  /** Cached count of non-guest members consuming a seat. */
  seatsUsed: number;
  plan: string; // org plan slug: org-free | org-starter | ...
  planActivatedAt: Date | null;
  planExpiresAt: Date | null;
  planPriceINR: number;
  basePlanPriceINR: number;
  autopayActive: boolean;
  isGracePeriod: boolean;
  gracePeriodEndsAt: Date | null;
  /** Optional per-team storage sub-limits (schema-flexible; not enforced yet). */
  teamQuotas: IOrgTeamQuota[];
  /** Immutable storage region for this org's files (default: asia). */
  storageRegion?: "asia" | "us" | "eu";
  createdAt: Date;
  updatedAt: Date;
}

const OrgTeamQuotaSchema = new Schema<IOrgTeamQuota>(
  {
    teamId: { type: String, required: true },
    limitBytes: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const OrgUsageSchema = new Schema<IOrgUsage>(
  {
    orgId: { type: String, required: true, unique: true, index: true },
    accountId: { type: String, default: null, index: true },
    totalStorageBytes: { type: Number, default: 0, min: 0 },
    totalObjects: { type: Number, default: 0, min: 0 },
    storageLimitBytes: { type: Number, default: ORG_FREE_TIER_LIMIT_BYTES },
    seats: { type: Number, default: ORG_FREE_SEATS, min: 0 },
    seatsUsed: { type: Number, default: 0, min: 0 },
    plan: { type: String, default: "org-free", index: true },
    planActivatedAt: { type: Date, default: null },
    planExpiresAt: { type: Date, default: null },
    planPriceINR: { type: Number, default: 0 },
    basePlanPriceINR: { type: Number, default: 0 },
    autopayActive: { type: Boolean, default: false },
    isGracePeriod: { type: Boolean, default: false },
    gracePeriodEndsAt: { type: Date, default: null },
    teamQuotas: { type: [OrgTeamQuotaSchema], default: [] },
    storageRegion: { type: String, enum: ["asia", "us", "eu"] },
  },
  { timestamps: true },
);

const OrgUsage: Model<IOrgUsage> =
  mongoose.models.OrgUsage ||
  mongoose.model<IOrgUsage>("OrgUsage", OrgUsageSchema);

export default OrgUsage;
