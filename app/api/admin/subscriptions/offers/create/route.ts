import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import dbConnect from "@/lib/mongodb";
import SubscriptionOffer from "@/models/SubscriptionOffer";
import { getActiveSubscriptionOffer } from "@/lib/subscriptions/service";

export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const validFrom = new Date(body.validFrom);
  const validUntil = body.validUntil ? new Date(body.validUntil) : null;
  const discountPercent = Number(body.discountPercent);

  if (!discountPercent || discountPercent < 1 || discountPercent > 99) {
    return NextResponse.json(
      { error: "discountPercent must be between 1 and 99" },
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

  // No longer pre-creating Razorpay plans for offers.
  // Discounted plans are created dynamically at subscription time using
  // createRazorpayRecurringPlan() in the subscription create route.
  const offer = await SubscriptionOffer.create({
    name: body.name,
    discountPercent,
    appliesForCycles: 1,
    validFrom,
    validUntil,
    isActive: true,
    originalAmount: Number(body.originalAmount) || 99900,
    createdBy: session.id,
  });

  return NextResponse.json({ offer }, { status: 201 });
}
