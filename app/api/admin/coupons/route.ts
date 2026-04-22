/**
 * GET  /api/admin/coupons  — list all coupons
 * POST /api/admin/coupons  — create a new coupon
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import Coupon from "@/models/Coupon";

export async function GET() {
  const session = await getAdminSession();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await dbConnect();
  const coupons = await Coupon.find().sort({ createdAt: -1 }).lean();
  return NextResponse.json({ coupons });
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    code,
    type,
    targetUserId,
    discountType,
    discountValue,
    maxUses,
    perUserLimit,
    applicablePlans,
    razorpayOfferId,
    validFrom,
    validTo,
    isActive,
  } = body;

  if (!code || !type || !discountType || !discountValue || !validFrom || !validTo) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (type === "user" && !targetUserId) {
    return NextResponse.json({ error: "targetUserId required for user-level coupons" }, { status: 400 });
  }
  if (discountType === "percent" && (discountValue <= 0 || discountValue > 100)) {
    return NextResponse.json({ error: "Percent discount must be 1–100" }, { status: 400 });
  }

  await dbConnect();

  try {
    const coupon = await Coupon.create({
      code: code.toUpperCase().trim(),
      type,
      targetUserId: type === "user" ? targetUserId : null,
      discountType,
      discountValue: Number(discountValue),
      maxUses: Number(maxUses ?? 0),
      perUserLimit: Number(perUserLimit ?? 1),
      applicablePlans: applicablePlans ?? [],
      razorpayOfferId: typeof razorpayOfferId === "string" && razorpayOfferId.trim()
        ? razorpayOfferId.trim()
        : undefined,
      validFrom: new Date(validFrom),
      validTo: new Date(validTo),
      isActive: isActive !== false,
      createdBy: session.username,
    });
    return NextResponse.json({ coupon }, { status: 201 });
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e?.code === 11000) {
      return NextResponse.json({ error: "Coupon code already exists" }, { status: 409 });
    }
    throw err;
  }
}
