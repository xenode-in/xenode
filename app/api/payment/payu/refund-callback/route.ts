import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Payment from "@/models/Payment";

/**
 * app/api/payment/payu/refund-callback/route.ts
 *
 * Webhook handler for PayU refund status updates.
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const data: Record<string, string> = {};
    formData.forEach((value, key) => {
      data[key] = value.toString();
    });

    console.log("[PayU Refund Webhook]:", data);

    const { txnid, mihpayid, status, refund_id } = data;

    if (status === "success" || status === "refunded") {
      await dbConnect();
      // Update payment record if it was previously in refund_pending
      // or just ensure it is marked as refunded.
      await Payment.findOneAndUpdate(
        { 
          $or: [
            { txnid: txnid },
            { "payuResponse.mihpayid": mihpayid },
            { "payuResponse.refundId": refund_id }
          ]
        },
        { $set: { status: "refunded" } }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Refund Callback Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
