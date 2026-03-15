/**
 * app/api/payment/payu/success/route.ts — PayU success webhook.
 *
 * FIXES (multi-cycle refactor):
 *   - planExpiresAt now uses getSubscriptionEndDate(now, pending.billingCycle)
 *     instead of the old hardcoded +30 days. Yearly plan → +1 year.
 *   - Payment record now stores billingCycle, subscriptionStartDate,
 *     subscriptionEndDate — the three new fields added to Payment model.
 *   - Usage.planPriceINR stores the base cycle price (not final charged amount)
 *     so future proration calculations remain correct.
 */
import { NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import Payment from "@/models/Payment";
import PendingTransaction from "@/models/PendingTransaction";
import Coupon from "@/models/Coupon";
import Subscription from "@/models/Subscription";
import PaymentService from "@/lib/pricing/PaymentService";
import mongoose from "mongoose";
import { getSubscriptionEndDate } from "@/lib/pricing/pricingService";

function toSuccessPage(baseUrl: string, params: Record<string, string>) {
  const url = new URL("/payment/success", baseUrl);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return NextResponse.redirect(url.toString(), { status: 303 });
}
function toFailurePage(baseUrl: string, params: Record<string, string>) {
  const url = new URL("/payment/failure", baseUrl);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return NextResponse.redirect(url.toString(), { status: 303 });
}

function verifyHash(data: Record<string, string>, salt: string, key: string): boolean {
  const {
    status,
    udf1 = "", udf2 = "", udf3 = "", udf4 = "", udf5 = "",
    email, firstname, productinfo, amount, txnid,
    hash: resHash, si_details,
  } = data;
  const reversePart = `${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  if (si_details) {
    const siHash = crypto.createHash("sha512")
      .update(`${salt}|${si_details}|${status}||||||${reversePart}`).digest("hex");
    if (siHash === resHash) return true;
  }
  return crypto.createHash("sha512")
    .update(`${salt}|${status}||||||${reversePart}`).digest("hex") === resHash;
}

export async function POST(req: Request) {
  let txnid: string | undefined;
  try {
    const formData = await req.formData();
    const data: Record<string, string> = {};
    formData.forEach((value, key) => { data[key] = value.toString(); });

    const key  = process.env.PAYU_MERCHANT_KEY  || "";
    const salt = process.env.PAYU_MERCHANT_SALT || "";
    const { status, amount, productinfo, udf1 } = data;
    txnid = data.txnid;

    const hashValid = verifyHash(data, salt, key);
    if (!hashValid) {
      if (process.env.NODE_ENV === "production") {
        return toFailurePage(req.url, { txnid: txnid ?? "", error: "hash_mismatch", plan: productinfo ?? "", amount: amount ?? "" });
      }
      console.warn("[SECURITY WARNING] Hash mismatch bypassed — NOT safe for production");
    }

    if (status !== "success") {
      return toFailurePage(req.url, { txnid: txnid ?? "", error: "payment_failed", plan: productinfo ?? "", amount: amount ?? "" });
    }

    if (!udf1 || !mongoose.Types.ObjectId.isValid(udf1)) {
      console.error("[SECURITY] Invalid udf1 in PayU success callback", { txnid });
      return toFailurePage(req.url, { txnid: txnid ?? "", error: "invalid_session", plan: productinfo ?? "", amount: amount ?? "" });
    }

    await dbConnect();

    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");

    const session = await mongoose.startSession();
    let resultUrl = "";

    try {
      await session.withTransaction(async () => {
        // Delegate to PaymentService
        const result = await PaymentService.processSuccessfulPayment(
          txnid || "",
          amount,
          productinfo,
          udf1,
          data,
          session
        );

        if (result.isIdempotent) {
          resultUrl = new URL("/payment/success", req.url).toString();
          return;
        }

        const url = new URL("/payment/success", req.url);
        url.searchParams.set("txnid", txnid || "");
        url.searchParams.set("plan", result.plan || "");
        url.searchParams.set("amount", result.amount || "");
        url.searchParams.set("method", result.method || "");
        url.searchParams.set("cycle", result.cycle || "");
        if (result.coupon) {
          url.searchParams.set("coupon", result.coupon);
        }
        resultUrl = url.toString();
      });
    } finally {
      session.endSession();
    }

    if (resultUrl) {
      if (resultUrl.includes("/payment/success")) {
         // It might be the idempotency branch which didn't set all query params,
         // but that's handled correctly as existingPayment redirects.
         // Let's refine idempotency redirect URL.
         const idempotencyUrl = new URL("/payment/success", req.url);
         const existingPayment = await Payment.findOne({ txnid: txnid || "" }); // already committed
         if (existingPayment && resultUrl === idempotencyUrl.toString()) {
           idempotencyUrl.searchParams.set("txnid", txnid || "");
           idempotencyUrl.searchParams.set("plan", existingPayment.planName ?? productinfo ?? "");
           idempotencyUrl.searchParams.set("amount", existingPayment.amount?.toString() ?? amount ?? "");
           return NextResponse.redirect(idempotencyUrl.toString(), { status: 303 });
         }
         return NextResponse.redirect(resultUrl, { status: 303 });
      }
    }

    return NextResponse.redirect(resultUrl, { status: 303 });
  } catch (error: any) {
    console.error("PayU success callback error:", error);
    
    // Check if we threw an internal error
    const errMap: Record<string, string> = {
      "transaction_not_found": "transaction_not_found",
      "amount_mismatch": "security_error",
      "product_mismatch": "security_error",
      "user_not_found": "user_not_found"
    };
    
    const errCode = errMap[error.message] || "server_error";
    return toFailurePage(req.url, { txnid: txnid || "", error: errCode });
  }
}
