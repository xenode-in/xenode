import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import SubscriptionOffer from "@/models/SubscriptionOffer";
import {
  BASE_MONTHLY_AMOUNT_PAISE,
  SUBSCRIPTION_PLAN_NAME,
} from "@/lib/subscriptions/constants";
import {
  createRazorpayRecurringPlan,
  getActiveSubscriptionOffer,
} from "@/lib/subscriptions/service";

export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const validFrom = new Date(body.validFrom);
  const validUntil = body.validUntil ? new Date(body.validUntil) : null;

  const existingActive = await getActiveSubscriptionOffer();
  if (existingActive) {
    return NextResponse.json(
      { error: "Only one active subscription offer can exist at a time" },
      { status: 409 },
    );
  }

  const plan = await createRazorpayRecurringPlan({
    amountPaise: Math.max(
      1,
      Math.round(BASE_MONTHLY_AMOUNT_PAISE * (1 - Number(body.discountPercent) / 100)),
    ),
    name: `${SUBSCRIPTION_PLAN_NAME} - ${body.name}`,
    description: `Offer plan for ${body.name}`,
  });

  const offer = await SubscriptionOffer.create({
    name: body.name,
    discountPercent: Number(body.discountPercent),
    appliesForCycles: 1,
    validFrom,
    validUntil,
    isActive: true,
    razorpayPlanId_offer: plan.id,
    originalAmount: BASE_MONTHLY_AMOUNT_PAISE,
    createdBy: session.id,
  });

  return NextResponse.json({ offer }, { status: 201 });
}
