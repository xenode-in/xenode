/**
 * POST /api/coupons/validate
 *
 * Server-side coupon validation. Called from checkout when user applies a code.
 * Returns the discount amount if valid — never trusts client-computed values.
 *
 * Body: { code: string, planSlug: string, planPriceINR: number }
 * Response: { valid: true, discountAmount: number, discountLabel: string, couponId: string }
 *         | { valid: false, error: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Coupon from "@/models/Coupon";

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ valid: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { code, planSlug, planPriceINR } = body;

  if (!code || typeof code !== "string") {
    return NextResponse.json({ valid: false, error: "Enter a coupon code" });
  }
  if (typeof planPriceINR !== "number" || planPriceINR <= 0) {
    return NextResponse.json({ valid: false, error: "Invalid plan" });
  }

  await dbConnect();

  const coupon = await Coupon.findOne({ code: code.toUpperCase().trim() }).lean();

  if (!coupon) {
    return NextResponse.json({ valid: false, error: "Invalid coupon code" });
  }

  if (!coupon.isActive) {
    return NextResponse.json({ valid: false, error: "This coupon is no longer active" });
  }

  const now = new Date();
  if (now < new Date(coupon.validFrom)) {
    return NextResponse.json({ valid: false, error: "This coupon is not yet valid" });
  }
  if (now > new Date(coupon.validTo)) {
    return NextResponse.json({ valid: false, error: "This coupon has expired" });
  }

  // Check max global uses
  if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
    return NextResponse.json({ valid: false, error: "This coupon has reached its usage limit" });
  }

  // Check user-level targeting
  if (coupon.type === "user" && coupon.targetUserId !== session.user.id) {
    return NextResponse.json({ valid: false, error: "This coupon is not valid for your account" });
  }

  // Check per-user usage limit
  const userUses = coupon.usedBy.filter((u) => u.userId === session.user.id).length;
  if (userUses >= coupon.perUserLimit) {
    return NextResponse.json({ valid: false, error: "You have already used this coupon" });
  }

  // Check plan restriction
  if (coupon.applicablePlans.length > 0 && !coupon.applicablePlans.includes(planSlug)) {
    return NextResponse.json({
      valid: false,
      error: `This coupon is only valid for: ${coupon.applicablePlans.join(", ")} plans`,
    });
  }

  // Compute discount
  let discountAmount: number;
  let discountLabel: string;

  if (coupon.discountType === "percent") {
    discountAmount = Math.round(planPriceINR * (coupon.discountValue / 100));
    discountLabel = `${coupon.discountValue}% off`;
  } else {
    discountAmount = Math.min(coupon.discountValue, planPriceINR - 1); // never free
    discountLabel = `₹${coupon.discountValue} off`;
  }

  return NextResponse.json({
    valid: true,
    discountAmount,
    discountLabel,
    couponId: coupon._id.toString(),
    code: coupon.code,
  });
}
