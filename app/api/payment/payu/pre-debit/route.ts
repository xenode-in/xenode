import { NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import mongoose from "mongoose";

/**
 * POST /api/payment/payu/pre-debit
 *
 * Called by Vercel Cron 48 hours before each user's plan renewal date.
 * Posts a pre_debit_SI notification to PayU — mandatory per RBI guidelines.
 *
 * Cron schedule: daily at 09:00 IST (03:30 UTC)
 * This route finds all users whose planExpiresAt is exactly 48h away
 * and whose autopayActive === true, then fires pre-debit for each.
 *
 * Protected by CRON_SECRET header — set this in Vercel env vars.
 */

function sha512(str: string): string {
  return crypto.createHash("sha512").update(str).digest("hex");
}

function buildCommandHash(key: string, command: string, var1: string, salt: string): string {
  return sha512(`${key}|${command}|${var1}|${salt}`);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function dateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  // Verify cron secret
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

  const now = new Date();
  // Find users expiring in 46–50h window (48h target ±2h buffer)
  const windowStart = addHours(now, 46);
  const windowEnd   = addHours(now, 50);

  const usersToNotify = await Usage.find({
    autopayActive: true,
    autopayMandateId: { $ne: null },
    planExpiresAt: { $gte: windowStart, $lte: windowEnd },
  }).lean();

  const results: { userId: string; status: string; message?: string }[] = [];

  for (const usage of usersToNotify) {
    try {
      const debitDate = dateStr(new Date(usage.planExpiresAt!));
      // requestId must be unique per pre-debit call
      const requestId = `${usage.autopayMandateId}_${Date.now()}`;

      const var1Obj = {
        authPayuId: usage.autopayMandateId,
        requestId,
        debitDate,
        amount: usage.planPriceINR.toFixed(2),
      };
      const var1 = JSON.stringify(var1Obj);
      const hash = buildCommandHash(key, "pre_debit_SI", var1, salt);

      const formData = new URLSearchParams({
        key,
        command: "pre_debit_SI",
        var1,
        hash,
      });

      const res = await fetch(payuBase, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      const data = await res.json();

      if (data.status === 1) {
        results.push({ userId: usage.userId, status: "ok", message: data.message });
      } else {
        // Pre-debit failed — mandate may have been revoked by user
        // Mark autopayActive false so we don’t try to charge
        await Usage.updateOne(
          { userId: usage.userId },
          { $set: { autopayActive: false } },
        );
        results.push({ userId: usage.userId, status: "failed", message: data.message });
      }
    } catch (err) {
      console.error(`[pre-debit] Failed for userId ${usage.userId}:`, err);
      results.push({ userId: usage.userId, status: "error" });
    }
  }

  return NextResponse.json({
    processed: usersToNotify.length,
    results,
  });
}
