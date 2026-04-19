import { NextResponse } from "next/server";
import razorpay from "@/lib/razorpay";
import { getServerSession } from "@/lib/auth/session";

export async function GET(req: Request, { params }: { params: Promise<{ subscriptionId: string }> }) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { subscriptionId } = await params;

    const sub = await razorpay.subscriptions.fetch(subscriptionId);

    return NextResponse.json({
      status: sub.status,
      currentPeriodStart: sub.current_start ? new Date(sub.current_start * 1000) : null,
      currentPeriodEnd: sub.current_end ? new Date(sub.current_end * 1000) : null,
      nextChargeAt: sub.charge_at ? new Date(sub.charge_at * 1000) : null,
      paidCount: sub.paid_count,
      remainingCount: sub.remaining_count,
    });
  } catch (error: any) {
    console.error("Razorpay Subscription Fetch Error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch subscription status" }, { status: 500 });
  }
}
