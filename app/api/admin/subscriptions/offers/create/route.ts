import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import SubscriptionOffer from "@/models/SubscriptionOffer";
import { getActiveSubscriptionOffer } from "@/lib/subscriptions/service";

/**
 * POST /api/admin/subscriptions/offers/create
 *
 * Creates a subscription offer that links to a Razorpay Offer
 * created on the Razorpay Dashboard.
 *
 * Body: {
 *   name: "Launch Offer",
 *   discountPercent: 50,
 *   razorpayOfferId: "offer_JHD834hjbxzhd38d",  // from Dashboard
 *   validFrom: "2026-04-22T00:00:00Z",
 *   validUntil: "2026-05-22T00:00:00Z",  // optional
 *   originalAmount: 69900  // base plan amount in paise (optional, defaults to 99900)
 * }
 */
export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const validFrom = new Date(body.validFrom);
  const validUntil = body.validUntil ? new Date(body.validUntil) : null;
  const discountPercent = Number(body.discountPercent);
  const razorpayOfferId =
    typeof body.razorpayOfferId === "string" ? body.razorpayOfferId.trim() : "";

  if (!discountPercent || discountPercent < 1 || discountPercent > 99) {
    return NextResponse.json(
      { error: "discountPercent must be between 1 and 99" },
      { status: 400 },
    );
  }

  if (!razorpayOfferId || !razorpayOfferId.startsWith("offer_")) {
    return NextResponse.json(
      {
        error:
          "razorpayOfferId is required. Create an offer on the Razorpay Dashboard and paste the ID (e.g., offer_JHD834hjbxzhd38d).",
      },
      { status: 400 },
    );
  }

  await dbConnect();

  const existingActive = await getActiveSubscriptionOffer();
  if (existingActive) {
    return NextResponse.json(
      { error: "Only one active subscription offer can exist at a time" },
      { status: 409 },
    );
  }

  const offer = await SubscriptionOffer.create({
    name: body.name,
    discountPercent,
    appliesForCycles: 1,
    validFrom,
    validUntil,
    isActive: true,
    razorpayOfferId,
    originalAmount: Number(body.originalAmount) || 99900,
    createdBy: session.id,
  });

  return NextResponse.json({ offer }, { status: 201 });
}
