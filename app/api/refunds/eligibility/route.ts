import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { jsonError } from "@/lib/billing/http";
import { checkRefundEligibility } from "@/lib/refunds/eligibility";

/**
 * GET /api/refunds/eligibility — does the current user qualify for a refund?
 *
 * Returns the eligibility decision + a payment summary the UI uses to render
 * the request form (amount, days remaining, etc.).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await checkRefundEligibility(session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
