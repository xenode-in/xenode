import { NextResponse } from "next/server";
import razorpay from "@/lib/razorpay";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Subscription from "@/models/Subscription";

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { subscriptionId, cancelAtCycleEnd = true } = await req.json();

    const cancelledSubscription = await razorpay.subscriptions.cancel(subscriptionId, cancelAtCycleEnd);

    await dbConnect();

    await Subscription.findOneAndUpdate(
      { subscription_id: subscriptionId, userId: session.user.id },
      { 
        $set: { 
          status: "cancelled", 
          cancel_at_cycle_end: cancelAtCycleEnd,
          updatedAt: new Date(),
        } 
      }
    );

    return NextResponse.json({ success: true, cancelledSubscription });
  } catch (error: any) {
    console.error("Razorpay Subscription Cancel Error:", error);
    return NextResponse.json({ error: error.message || "Failed to cancel subscription" }, { status: 500 });
  }
}
