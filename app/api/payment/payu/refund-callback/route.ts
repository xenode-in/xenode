import { NextResponse } from "next/server";

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
    console.warn("[PayU Refund Webhook] Ignoring unauthenticated callback", {
      txnid,
      mihpayid,
      status,
      refund_id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Refund Callback Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
