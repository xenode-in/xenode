import { z } from "zod";

/**
 * Zod schemas for every billing route boundary.
 *
 * Rules:
 * - Every body field that influences money MUST be validated here.
 * - String enums use literal unions, not free `z.string()`.
 * - Coupon codes are normalised (trim + uppercase) at parse time.
 * - Amounts are not accepted from the client — server resolves authoritative prices.
 */

export const billingCycleSchema = z.enum([
  "monthly",
  "quarterly",
  "yearly",
  "lifetime",
]);

export const planSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_-]+$/, "planSlug must be lowercase alphanumeric");

export const couponCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((s) => s.toUpperCase());

/**
 * Razorpay offer_id format: `offer_` followed by exactly 14 alphanumeric
 * characters (20 chars total). Validating here so the gateway never sees a
 * malformed value.
 */
export const razorpayOfferIdSchema = z
  .string()
  .trim()
  .regex(
    /^offer_[A-Za-z0-9]{14}$/,
    "razorpayOfferId must be `offer_` + 14 alphanumeric characters",
  );

/**
 * Accept a normalised coupon code, an empty string, null, or omitted.
 * Empty string and null both collapse to `undefined`, so downstream code only
 * has to check `if (input.couponCode)`. The client SubscribeButton sends
 * `couponCode: null` when no coupon is applied — must not blow up Zod.
 */
const optionalCouponCodeField = z
  .union([couponCodeSchema, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const optionalPhoneField = z
  .union([z.string().trim().max(32), z.null()])
  .optional()
  .transform((v) => v ?? "");

/** POST /api/subscriptions/create */
export const createSubscriptionSchema = z.object({
  planSlug: planSlugSchema,
  billingCycle: billingCycleSchema.default("monthly"),
  couponCode: optionalCouponCodeField,
  phone: optionalPhoneField,
});

/** POST /api/subscriptions/cancel */
export const cancelSubscriptionSchema = z.object({
  subscriptionId: z.string().trim().min(1).optional(),
  cancelAtPeriodEnd: z.boolean().default(true),
});

/** POST /api/subscriptions/pause */
export const pauseSubscriptionSchema = z.object({
  subscriptionId: z.string().trim().min(1).optional(),
});

export const resumeSubscriptionSchema = pauseSubscriptionSchema;

/** POST /api/subscriptions/change-plan */
export const changePlanSchema = z.object({
  newPlanSlug: planSlugSchema,
  newBillingCycle: billingCycleSchema,
  effective: z.enum(["immediate", "period_end"]).default("period_end"),
});

/** POST /api/coupons/validate (preview) */
export const validateCouponSchema = z.object({
  code: couponCodeSchema,
  planSlug: planSlugSchema,
  billingCycle: billingCycleSchema,
});

/** Admin: create/update coupon */
export const adminCouponSchema = z.object({
  code: couponCodeSchema,
  type: z.enum(["global", "user"]),
  targetUserId: z.string().trim().optional().nullable(),
  discountType: z.enum(["percent", "flat"]),
  discountValue: z.number().positive(),
  maxUses: z.number().int().min(0).default(0),
  perUserLimit: z.number().int().min(1).default(1),
  applicablePlans: z.array(planSlugSchema).default([]),
  razorpayOfferId: razorpayOfferIdSchema.optional().nullable(),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date(),
  isActive: z.boolean().default(true),
});

/** Admin: create/update campaign */
export const adminCampaignSchema = z.object({
  name: z.string().trim().min(1).max(128),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/),
  discountPercent: z.number().int().min(1).max(99).optional(),
  flatDiscountPaise: z.number().int().positive().optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  isActive: z.boolean().default(true),
  badge: z.string().trim().max(32).optional(),
  duration: z.enum(["forever", "limited"]).default("limited"),
  cycles: z.number().int().min(1).optional(),
  targetAudience: z
    .custom<"all" | "free_only" | `plan:${string}`>(
      (value) =>
        value === "all" ||
        value === "free_only" ||
        (typeof value === "string" && /^plan:[a-z0-9_-]+$/u.test(value)),
      "targetAudience must be all, free_only, or plan:<slug>",
    )
    .default("all"),
  applicablePlans: z.array(planSlugSchema).default([]),
  applicableCycles: z.array(billingCycleSchema).default([]),
  razorpayOfferId: razorpayOfferIdSchema.optional().nullable(),
  priority: z.number().int().default(100),
  maxRedemptions: z.number().int().positive().optional(),
});

/** Admin: update a plan's pricing entry */
export const adminPlanUpdateSchema = z.object({
  planSlug: planSlugSchema,
  pricing: z.array(
    z.object({
      cycle: billingCycleSchema,
      priceINR: z.number().nonnegative(),
      discountPercent: z.number().int().min(0).max(99).optional(),
      razorpayPlanId: z.string().trim().optional(),
    }),
  ),
  features: z.array(z.string().max(256)).optional(),
  isPopular: z.boolean().optional(),
});

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;
export type ChangePlanInput = z.infer<typeof changePlanSchema>;
export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;
export type AdminCouponInput = z.infer<typeof adminCouponSchema>;
export type AdminCampaignInput = z.infer<typeof adminCampaignSchema>;
