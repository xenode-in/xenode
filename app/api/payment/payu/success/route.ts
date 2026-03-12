import { NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import Payment from "@/models/Payment";
import PendingTransaction from "@/models/PendingTransaction";
import mongoose from "mongoose";

// ── helpers ──────────────────────────────────────────────────────────────

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

/**
 * Verify PayU reverse hash.
 * Supports both regular and SI (UPI Autopay mandate) formats:
 *   Regular : salt|status||||||||||udf1|email|firstname|productinfo|amount|txnid|key
 *   SI      : salt|status||||||||||udf1|email|firstname|productinfo|amount|txnid|key|si_details
 */
function verifyHash(data: Record<string, string>, salt: string, key: string): boolean {
  const { status, udf1, email, firstname, productinfo, amount, txnid, hash: resHash, si_details } = data;

  // Try SI hash first if si_details is present
  if (si_details) {
    const siHashStr = `${salt}|${status}||||||||||${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}|${si_details}`;
    const siHash = crypto.createHash("sha512").update(siHashStr).digest("hex");
    if (siHash === resHash) return true;
  }

  // Fall back to regular hash
  const hashStr = `${salt}|${status}||||||||||${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  const hash = crypto.createHash("sha512").update(hashStr).digest("hex");
  return hash === resHash;
}

// ── route ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const data: Record<string, string> = {};
    formData.forEach((value, key) => { data[key] = value.toString(); });

    const key  = process.env.PAYU_MERCHANT_KEY  || "";
    const salt = process.env.PAYU_MERCHANT_SALT || "";

    const { status, firstname, amount, txnid, productinfo, email, udf1 } = data;

    // CVE-1: Hash verification — supports both SI and regular formats
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

    // CVE-4: Strict udf1 validation
    if (!udf1 || !mongoose.Types.ObjectId.isValid(udf1)) {
      console.error("[SECURITY] Invalid udf1 in PayU success callback", { txnid });
      return toFailurePage(req.url, { txnid: txnid ?? "", error: "invalid_session", plan: productinfo ?? "", amount: amount ?? "" });
    }

    await dbConnect();

    // CVE-2: Idempotency guard
    const existingPayment = await Payment.findOne({ txnid });
    if (existingPayment) {
      return toSuccessPage(req.url, {
        txnid,
        plan: existingPayment.planName ?? productinfo ?? "",
        amount: existingPayment.amount?.toString() ?? amount ?? "",
      });
    }

    // CVE-3: Resolve plan from server-side PendingTransaction
    const pending = await PendingTransaction.findOne({ txnid, userId: udf1 });
    if (!pending) {
      console.error("[SECURITY] No pending transaction found for txnid", { txnid, udf1 });
      return toFailurePage(req.url, { txnid, error: "transaction_not_found", plan: productinfo ?? "", amount: amount ?? "" });
    }

    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");

    const user = await db
      .collection("user")
      .findOne({ _id: new mongoose.Types.ObjectId(udf1) });

    if (!user) {
      return toFailurePage(req.url, { txnid, error: "user_not_found", plan: productinfo ?? "", amount: amount ?? "" });
    }

    // Persist billing address to user profile if provided
    if (pending.billingAddress) {
      await db.collection("user").updateOne(
        { _id: new mongoose.Types.ObjectId(udf1) },
        { $set: { billingAddress: pending.billingAddress } },
      );
    }

    // For UPI Autopay: capture the authpayuid returned by PayU
    const authpayuid = data.payuMoneyId || data.authpayuid || null;

    // CVE-2: Atomic transaction
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
            scheduledDowngradePlan: null,
            scheduledDowngradeLimitBytes: null,
            scheduledDowngradeAt: null,
            // Store autopay mandate ID for recurring charge cron
            ...(authpayuid ? { autopayMandateId: authpayuid, autopayActive: true } : {}),
          },
        },
        { upsert: true, session: mongoSession },
      );

      // CVE-8: Only persist safe, non-PII fields
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
              ...(authpayuid ? { authpayuid } : {}),
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

    // CVE-3: Clean up pending transaction
    await PendingTransaction.deleteOne({ txnid });

    return toSuccessPage(req.url, {
      txnid,
      plan: pending.planName,
      amount: pending.planPriceINR.toString(),
      method: pending.paymentMethod,
    });

  } catch (error) {
    console.error("PayU success callback error:", error);
    return toFailurePage("http://localhost:3000", { error: "server_error" });
  }
}
