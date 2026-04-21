import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import {
  BASE_MONTHLY_AMOUNT_PAISE,
  SUBSCRIPTION_PLAN_NAME,
} from "@/lib/subscriptions/constants";
import {
  createRazorpayRecurringPlan,
  updatePricingBasePlan,
} from "@/lib/subscriptions/service";

export async function POST() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const plan = await createRazorpayRecurringPlan({
    amountPaise: BASE_MONTHLY_AMOUNT_PAISE,
    name: SUBSCRIPTION_PLAN_NAME,
    description: "Base recurring subscription plan",
  });

  await updatePricingBasePlan(plan.id);

  return NextResponse.json({
    success: true,
    planId: plan.id,
    amount: BASE_MONTHLY_AMOUNT_PAISE / 100,
  });
}
