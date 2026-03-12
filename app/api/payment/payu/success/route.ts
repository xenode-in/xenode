import { NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import Payment from "@/models/Payment";
import PendingTransaction from "@/models/PendingTransaction";
import mongoose from "mongoose";

const redirectHtml = (url: string) => `
  <!DOCTYPE html>
  <html>
    <head><meta http-equiv="refresh" content="0;url=${url}"></head>
    <body>
      <p>Redirecting...</p>
      <script>window.location.href = "${url}";</script>
    </body>
  </html>
`;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const data: Record<string, string> = {};
    formData.forEach((value, key) => {
      data[key] = value.toString();
    });

    const key = process.env.PAYU_MERCHANT_KEY || "";
    const salt = process.env.PAYU_MERCHANT_SALT || "";

    const { status, firstname, amount, txnid, hash: resHash, productinfo, email, udf1 } = data;

    // CVE-1: Always verify hash — only bypass in non-production with explicit warning
    const hashString = `${salt}|${status}||||||||||${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
    const calculatedHash = crypto
      .createHash("sha512")
      .update(hashString)
      .digest("hex");

    const hashValid = calculatedHash === resHash;
    if (!hashValid) {
      if (process.env.NODE_ENV === "production") {
        return new NextResponse(
          redirectHtml(
            new URL("/dashboard/billing?error=hash_mismatch", req.url).toString(),
          ),
          { headers: { "Content-Type": "text/html" } },
        );
      }
      // Non-production: log loudly but allow through for testing
      console.warn("[SECURITY WARNING] Hash mismatch bypassed — NOT safe for production");
    }

    if (status !== "success") {
      return new NextResponse(
        redirectHtml(
          new URL("/dashboard/billing?error=payment_failed", req.url).toString(),
        ),
        { headers: { "Content-Type": "text/html" } },
      );
    }

    // CVE-4: Strict udf1 validation — no email fallback
    if (!udf1 || !mongoose.Types.ObjectId.isValid(udf1)) {
      console.error("[SECURITY] Invalid udf1 in PayU success callback", { txnid });
      return new NextResponse(
        redirectHtml(
          new URL("/dashboard/billing?error=invalid_session", req.url).toString(),
        ),
        { headers: { "Content-Type": "text/html" } },
      );
    }

    await dbConnect();

    // CVE-2: Idempotency guard — check if already processed
    const existingPayment = await Payment.findOne({ txnid });
    if (existingPayment) {
      // Already processed — safe to redirect without re-upgrading
      return new NextResponse(
        redirectHtml(
          new URL("/dashboard/billing?success=true", req.url).toString(),
        ),
        { headers: { "Content-Type": "text/html" } },
      );
    }

    // CVE-3: Resolve plan from server-side PendingTransaction — never from productinfo
    const pending = await PendingTransaction.findOne({ txnid, userId: udf1 });
    if (!pending) {
      console.error("[SECURITY] No pending transaction found for txnid", { txnid, udf1 });
      return new NextResponse(
        redirectHtml(
          new URL("/dashboard/billing?error=transaction_not_found", req.url).toString(),
        ),
        { headers: { "Content-Type": "text/html" } },
      );
    }

    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");

    const user = await db
      .collection("user")
      .findOne({ _id: new mongoose.Types.ObjectId(udf1) });

    if (!user) {
      return new NextResponse(
        redirectHtml(
          new URL("/dashboard/billing?error=user_not_found", req.url).toString(),
        ),
        { headers: { "Content-Type": "text/html" } },
      );
    }

    // CVE-2: Atomic transaction — both writes succeed or both fail
    const mongoSession = await mongoose.startSession();
    mongoSession.startTransaction();
    try {
      await Usage.findOneAndUpdate(
        { userId: user._id.toString() },
        {
          $set: {
            plan: "pro",
            storageLimitBytes: pending.storageLimitBytes,
            planPriceINR: pending.planPriceINR,
            planActivatedAt: new Date(),
            planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            // Clear any pending downgrade on upgrade
            scheduledDowngradePlan: null,
            scheduledDowngradeLimitBytes: null,
            scheduledDowngradeAt: null,
          },
        },
        { upsert: true, session: mongoSession },
      );

      // CVE-8: Only persist safe, non-PII fields from PayU response
      await Payment.create(
        [
          {
            userId: user._id.toString(),
            amount: parseFloat(amount),
            currency: "INR",
            status: "success",
            txnid,
            planName: pending.planName,
            payuResponse: {
              status: data.status,
              txnid: data.txnid,
              mode: data.mode,
              PG_TYPE: data.PG_TYPE,
              bank_ref_num: data.bank_ref_num,
            },
          },
        ],
        { session: mongoSession },
      );

      await mongoSession.commitTransaction();
    } catch (txnError) {
      await mongoSession.abortTransaction();
      throw txnError;
    } finally {
      mongoSession.endSession();
    }

    // Clean up pending transaction after successful processing
    await PendingTransaction.deleteOne({ txnid });

    return new NextResponse(
      redirectHtml(
        new URL("/dashboard/billing?success=true", req.url).toString(),
      ),
      { headers: { "Content-Type": "text/html" } },
    );
  } catch (error) {
    console.error("PayU success callback error:", error);
    return new NextResponse(
      redirectHtml("/dashboard/billing?error=server_error"),
      { headers: { "Content-Type": "text/html" } },
    );
  }
}
