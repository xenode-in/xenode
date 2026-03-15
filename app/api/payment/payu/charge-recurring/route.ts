import { NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import Payment from "@/models/Payment";
import mongoose from "mongoose";

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  free: "Free Tier",
  basic: "Basic Plan",
  pro: "Pro Plan",
  plus: "Plus Plan",
  max: "Max Plan",
  enterprise: "Enterprise",
};

/**
 * POST /api/payment/payu/charge-recurring
 *
 * Called by Vercel Cron on the day of plan renewal.
 * Posts si_transaction to PayU for each user with autopayActive === true
 * whose planExpiresAt falls within the next 2 hours.
 *
 * PayU always returns status="pending" for UPI recurring — final status
 * arrives async via webhook (implement separately) or verify_payment API.
 *
 * Cron schedule: daily at 09:00 IST (03:30 UTC)
 * Protected by CRON_SECRET header.
 */

function sha512(str: string): string {
  return crypto.createHash("sha512").update(str).digest("hex");
}

function buildCommandHash(key: string, command: string, var1: string, salt: string): string {
  return sha512(`${key}|${command}|${var1}|${salt}`);
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();

  const key  = process.env.PAYU_MERCHANT_KEY  || "";
  const salt = process.env.PAYU_MERCHANT_SALT || "";

  const isTestMode = process.env.NODE_ENV !== "production";
  const payuBase = isTestMode
    ? "https://test.payu.in/merchant/postservice.php?form=2"
    : "https://info.payu.in/merchant/postservice.php?form=2";

  const db = mongoose.connection.db;
  if (!db) throw new Error("DB not connected");

  const now = new Date();
  // Find users expiring within the next 2-hour window
  const windowEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const usersToCharge = await Usage.find({
    autopayActive: true,
    autopayMandateId: { $ne: null },
    planExpiresAt: { $gte: now, $lte: windowEnd },
  }).lean();

  const results: { userId: string; txnid?: string; status: string; message?: string }[] = [];

  for (const usage of usersToCharge) {
    try {
      // Fetch user email + phone for PayU
      const userDoc = await db
        .collection("user")
        .findOne(
          { _id: new mongoose.Types.ObjectId(usage.userId) },
          { projection: { email: 1, phone: 1, name: 1 } },
        );

      if (!userDoc) {
        results.push({ userId: usage.userId, status: "skipped", message: "user not found" });
        continue;
      }

      const txnid = "REC" + Date.now() + crypto.randomBytes(6).toString("hex");
      const amount = usage.planPriceINR.toFixed(2);

      const var1Obj = {
        authpayuid: usage.autopayMandateId,
        amount,
        txnid,
        firstname: userDoc.name || "User",
        phone: userDoc.phone || "",
        email: userDoc.email || "",
        udf1: usage.userId, // echo back userId for webhook reconciliation
        udf2: "",
        udf3: "",
        udf4: "",
        udf5: "",
      };
      const var1 = JSON.stringify(var1Obj);
      const hash = buildCommandHash(key, "si_transaction", var1, salt);

      const formData = new URLSearchParams({
        key,
        command: "si_transaction",
        var1,
        hash,
      });

      const res = await fetch(payuBase, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      const data = await res.json();
      const detail = data?.details?.[txnid];
      const txnStatus = detail?.status ?? "unknown";

      // Create Payment record as pending — webhook / verify_payment will update it
      await Payment.create({
        userId: usage.userId,
        amount: parseFloat(amount),
        currency: "INR",
        status: txnStatus === "captured" ? "success" : "pending",
        txnid,
        planName: PLAN_DISPLAY_NAMES[usage.plan] || usage.plan,
        payuResponse: {
          status: txnStatus,
          payuid: detail?.payuid ?? "",
          field9: detail?.field9 ?? "",
          authpayuid: usage.autopayMandateId,
        },
      });

      // If PayU immediately confirms captured (rare for UPI) — extend plan now
      // Otherwise extension happens via webhook
      if (txnStatus === "captured") {
        await Usage.updateOne(
          { userId: usage.userId },
          {
            $set: {
              planActivatedAt: new Date(),
              planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              lastRenewalTxnid: txnid,
            },
          },
        );
      } else if (txnStatus === "failed" || txnStatus === "error") {
        // Mandate failed — deactivate autopay, let plan expire naturally
        await Usage.updateOne(
          { userId: usage.userId },
          { $set: { autopayActive: false, lastRenewalTxnid: txnid } },
        );
      } else {
        // Pending — store txnid, webhook will handle the rest
        await Usage.updateOne(
          { userId: usage.userId },
          { $set: { lastRenewalTxnid: txnid } },
        );
      }

      results.push({ userId: usage.userId, txnid, status: txnStatus });
    } catch (err) {
      console.error(`[charge-recurring] Failed for userId ${usage.userId}:`, err);
      results.push({ userId: usage.userId, status: "error" });
    }
  }

  return NextResponse.json({
    processed: usersToCharge.length,
    results,
  });
}
