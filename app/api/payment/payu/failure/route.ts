import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Payment from "@/models/Payment";
import crypto from "crypto";

// ─── helpers ────────────────────────────────────────────────────────────────

function toFailurePage(baseUrl: string, params: Record<string, string>) {
  const url = new URL("/payment/failure", baseUrl);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return NextResponse.redirect(url.toString(), { status: 303 });
}

// ─── route ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const data: Record<string, string> = {};
    formData.forEach((value, key) => {
      data[key] = value.toString();
    });

    const { amount, txnid, productinfo, udf1 } = data;

    // CVE-8: Redacted safe log — never log PII (email, phone, name)
    console.error("[Payment failed]", {
      txnid: txnid || "unknown",
      amount: amount || "unknown",
      productinfo: productinfo || "unknown",
    });

    if (udf1) {
      await dbConnect();
      try {
        // CVE-2: Idempotency — don't duplicate failed payment records
        const existing = await Payment.findOne({ txnid });
        if (!existing) {
          await Payment.create({
            userId: udf1,
            amount: parseFloat(amount) || 0,
            currency: "INR",
            status: "failed",
            txnid: txnid || "FAILED-" + crypto.randomBytes(8).toString("hex"),
            planName: productinfo || "Unknown",
            // CVE-8: Only store non-PII fields
            payuResponse: {
              status: data.status,
              txnid: data.txnid,
              mode: data.mode,
              error: data.error,
              error_Message: data.error_Message,
            },
          });
        }
      } catch (err) {
        console.error("Failed to save failed payment to DB", err);
      }
    }

    return toFailurePage(req.url, {
      txnid: txnid ?? "",
      error: "payment_failed",
      plan: productinfo ?? "",
      amount: amount ?? "",
    });

  } catch (error) {
    console.error("PayU failure callback error:", error);
    return toFailurePage("http://localhost:3000", { error: "server_error" });
  }
}
