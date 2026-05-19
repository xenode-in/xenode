import type { ClientSession } from "mongoose";
import dbConnect from "@/lib/mongodb";
import Coupon, { type ICoupon } from "@/models/Coupon";
import { BillingError } from "./http";

/**
 * CouponService — single source of truth for coupon validation and redemption.
 *
 * Reused by:
 *   - POST /api/subscriptions/create   (recurring, applies Razorpay offer_id)
 *   - POST /api/payment/razorpay/create-order  (one-time, applies discount inline)
 *   - POST /api/coupons/validate       (preview)
 *   - lib/payment/fulfillmentService.ts (consumes after payment success)
 *
 * Validation is read-only; `redeem` mutates `usedCount` + `usedBy`. Redemption
 * is idempotent via the `usedBy.txnid` uniqueness check — replays of the same
 * payment never double-count.
 */

export interface ValidatedCoupon {
  id: string;
  code: string;
  discountType: "percent" | "flat";
  discountValue: number;
  /** Set when the coupon has a linked Razorpay offer (subscription flow). */
  razorpayOfferId: string | null;
  applicablePlans: string[];
}

export interface ValidateArgs {
  code: string;
  userId: string;
  planSlug: string;
  /** Required when the caller wants to enforce subscription-flow constraints
   *  (e.g. coupon must have razorpayOfferId). */
  requireRazorpayOffer?: boolean;
  now?: Date;
}

export async function validateCoupon(
  args: ValidateArgs,
): Promise<ValidatedCoupon> {
  await dbConnect();
  const normalised = args.code.trim().toUpperCase();
  if (!normalised) {
    throw new BillingError(400, "Enter a coupon code", "coupon_missing");
  }

  const coupon = await Coupon.findOne({
    code: normalised,
    isActive: true,
  }).lean<ICoupon | null>();

  if (!coupon) {
    throw new BillingError(400, "Invalid coupon code", "coupon_invalid");
  }

  const now = args.now ?? new Date();
  if (now < new Date(coupon.validFrom)) {
    throw new BillingError(400, "This coupon is not yet valid", "coupon_not_started");
  }
  if (now > new Date(coupon.validTo)) {
    throw new BillingError(400, "This coupon has expired", "coupon_expired");
  }
  if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
    throw new BillingError(
      400,
      "This coupon has reached its usage limit",
      "coupon_exhausted",
    );
  }
  if (coupon.type === "user" && coupon.targetUserId !== args.userId) {
    throw new BillingError(
      400,
      "This coupon is not valid for your account",
      "coupon_user_mismatch",
    );
  }
  const userUses = coupon.usedBy.filter((u) => u.userId === args.userId).length;
  if (userUses >= coupon.perUserLimit) {
    throw new BillingError(
      400,
      "You have already used this coupon",
      "coupon_per_user_exhausted",
    );
  }
  if (
    coupon.applicablePlans.length > 0 &&
    !coupon.applicablePlans.includes(args.planSlug)
  ) {
    throw new BillingError(
      400,
      `This coupon is only valid for: ${coupon.applicablePlans.join(", ")} plans`,
      "coupon_plan_mismatch",
    );
  }
  if (args.requireRazorpayOffer && !coupon.razorpayOfferId) {
    throw new BillingError(
      400,
      "This coupon is not configured for subscriptions. Please contact support.",
      "coupon_no_offer",
    );
  }

  return {
    id: coupon._id.toString(),
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    razorpayOfferId: coupon.razorpayOfferId ?? null,
    applicablePlans: coupon.applicablePlans,
  };
}

/**
 * Compute the discount in paise. Capped so the final charge is at least 1 INR.
 */
export function computeDiscountPaise(
  coupon: Pick<ValidatedCoupon, "discountType" | "discountValue">,
  baseAmountPaise: number,
): number {
  if (coupon.discountType === "percent") {
    return Math.round(baseAmountPaise * (coupon.discountValue / 100));
  }
  const flatPaise = Math.round(coupon.discountValue * 100);
  return Math.min(flatPaise, Math.max(0, baseAmountPaise - 100));
}

export interface RedeemArgs {
  couponId: string;
  userId: string;
  txnid: string;
  session?: ClientSession;
}

/**
 * Records a redemption. Returns true if this call mutated state, false if it
 * was a replay of an already-counted txnid. Safe to call from inside a Mongo
 * transaction by passing `session`.
 */
export async function redeemCoupon(args: RedeemArgs): Promise<boolean> {
  await dbConnect();
  const result = await Coupon.updateOne(
    {
      _id: args.couponId,
      "usedBy.txnid": { $ne: args.txnid },
    },
    {
      $inc: { usedCount: 1 },
      $push: {
        usedBy: {
          userId: args.userId,
          usedAt: new Date(),
          txnid: args.txnid,
        },
      },
    },
    args.session ? { session: args.session } : undefined,
  );
  return result.modifiedCount > 0;
}

/**
 * Look up coupon by code without validation, used by the fulfillment path
 * which only needs the coupon id to redeem.
 */
export async function findCouponByCode(
  code: string,
): Promise<{ id: string; code: string } | null> {
  await dbConnect();
  const coupon = await Coupon.findOne({
    code: code.trim().toUpperCase(),
  })
    .select("_id code")
    .lean<{ _id: { toString(): string }; code: string } | null>();
  if (!coupon) return null;
  return { id: coupon._id.toString(), code: coupon.code };
}
