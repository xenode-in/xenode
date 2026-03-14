/**
 * Public API route to serve plans to client components (e.g. OnboardingForm).
 * Does NOT expose admin session — any authenticated user can call this.
 * Campaign discounts are NOT applied here — onboarding shows base prices.
 * The actual discounted price is shown on the /pricing page (server-rendered).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getPricingConfig } from "@/lib/config/getPricingConfig";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { plans } = await getPricingConfig();
  return NextResponse.json({ plans });
}
