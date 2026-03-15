/**
 * app/api/payment/payu/route.ts — Payment initiation.
 *
 * FIXES (multi-cycle refactor):
 *   - Reads `billingCycle` from request body (sent by CheckoutForm).
 *   - Passes cycle to getPlanConfigFromDB() so yearly price is used for yearly checkouts.
 *   - Stores billingCycle + planSlug in PendingTransaction for the success webhook.
 *   - planPriceINR stored in PendingTransaction is the BASE price (before coupon/proration)
 *     so the success webhook can correctly calculate subscription end date.
 *   - autopay si_details.billingCycle now reflects the actual selected cycle.
 */
import { NextResponse } from "next/server";
import crypto from "crypto";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import Payment from "@/models/Payment";
import PendingTransaction from "@/models/PendingTransaction";
import Coupon from "@/models/Coupon";
import mongoose from "mongoose";
import { getPlanConfigFromDB } from "@/lib/config/getPricingConfig";
import type { BillingCycle } from "@/types/pricing";

const PHONE_RE = /^[6-9]\d{9}$/;
const VALID_CYCLES: BillingCycle[] = ["monthly", "yearly", "quarterly", "lifetime"];

// Map our BillingCycle to PayU SI billingCycle strings
const PAYU_SI_CYCLE: Record<BillingCycle, string> = {
  monthly: "MONTHLY",
  yearly: "YEARLY",
  quarterly: "QUARTERLY",
  lifetime: "MONTHLY", // lifetime has no autopay equivalent — fallback
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function addPeriodStr(date: Date, cycle: BillingCycle): string {
  const d = new Date(date);
  switch (cycle) {
    case "monthly":   d.setMonth(d.getMonth() + 1); break;
    case "yearly":    d.setFullYear(d.getFullYear() + 1); break;
    case "quarterly": d.setMonth(d.getMonth() + 3); break;
    case "lifetime":  d.setFullYear(d.getFullYear() + 99); break;
  }
  return d.toISOString().slice(0, 10);
}
function sha512(str: string): string {
  return crypto.createHash("sha512").update(str).digest("hex");
}
function forwardHash(
  key: string, salt: string, txnid: string, amount: string,
  productinfo: string, firstname: string, email: string,
  udf1: string, siDetailsStr?: string
): string {
  const core = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udf1}||||||||||`;
  if (siDetailsStr) return sha512(`${core}${siDetailsStr}|${salt}`);
  return sha512(`${core}${salt}`);
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      planName,
      planSlug,
      billingCycle: rawCycle,
      paymentMethod = "direct",
      phone: clientPhone,
      billingAddress,
      couponCode,
    } = body;

    // Validate and normalise billing cycle — default to monthly
    const billingCycle: BillingCycle =
      rawCycle && VALID_CYCLES.includes(rawCycle) ? rawCycle : "monthly";

    // Fetch server-authoritative plan config for the selected cycle
    // This is the ONLY place that should determine the charge amount.
    const PLAN_CONFIG = await getPlanConfigFromDB(billingCycle);
    const plan = PLAN_CONFIG[planName];
    if (!plan) {
      return NextResponse.json({ error: "Invalid plan selection" }, { status: 400 });
    }

    if (paymentMethod !== "autopay" && paymentMethod !== "direct") {
      return NextResponse.json({ error: "Invalid payment method" }, { status: 400 });
    }

    const phone = typeof clientPhone === "string" ? clientPhone.replace(/\s/g, "") : "";
    if (!PHONE_RE.test(phone)) {
      return NextResponse.json(
        { error: "Invalid phone number. Enter a 10-digit Indian mobile number." },
        { status: 400 }
      );
    }

    await dbConnect();

    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");

    const userDoc = await db
      .collection("user")
      .findOne(
        { _id: new mongoose.Types.ObjectId(session.user.id) },
        { projection: { name: 1, email: 1 } }
      );
    if (!userDoc) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // ── Server-side coupon validation ────────────────────────────────────────
    let couponId: string | null = null;
    let couponDiscount = 0;
    let validatedCouponCode: string | null = null;

    if (couponCode && typeof couponCode === "string") {
      const coupon = await Coupon.findOne({
        code: couponCode.toUpperCase().trim(),
        isActive: true,
      }).lean();

      const now = new Date();
      const isValidCoupon =
        coupon &&
        now >= new Date(coupon.validFrom) &&
        now <= new Date(coupon.validTo) &&
        (coupon.maxUses === 0 || coupon.usedCount < coupon.maxUses) &&
        (coupon.type === "global" || coupon.targetUserId === session.user.id) &&
        coupon.usedBy.filter((u) => u.userId === session.user.id).length < coupon.perUserLimit &&
        (coupon.applicablePlans.length === 0 || coupon.applicablePlans.includes(planSlug ?? ""));

      if (isValidCoupon && coupon) {
        couponId = coupon._id.toString();
        validatedCouponCode = coupon.code;
        if (coupon.discountType === "percent") {
          couponDiscount = Math.round(plan.priceINR * (coupon.discountValue / 100));
        } else {
          couponDiscount = Math.min(coupon.discountValue, plan.priceINR - 1);
        }
      }
    }

    // plan.priceINR is already the campaign-discounted price from getPlanConfigFromDB
    let finalAmount = plan.priceINR - couponDiscount;
    let prorationCredit = 0;

    const currentUsage = await Usage.findOne({ userId: session.user.id });
    if (
      currentUsage &&
      currentUsage.plan !== "free" &&
      currentUsage.planExpiresAt &&
      currentUsage.planExpiresAt.getTime() > Date.now() &&
      currentUsage.planPriceINR > 0
    ) {
      const msRemaining = currentUsage.planExpiresAt.getTime() - Date.now();
      
      // Determine the cycle length of the current active plan
      const lastPayment = await Payment.findOne(
        { userId: session.user.id, status: "success" }
      ).sort({ createdAt: -1 }).select("billingCycle");
      
      const oldCycle = lastPayment?.billingCycle || "monthly";
      const cycleDays = oldCycle === "yearly" ? 365 : (oldCycle === "quarterly" ? 90 : 30);
      const cycleMs = cycleDays * 24 * 60 * 60 * 1000;
      
      prorationCredit = currentUsage.planPriceINR * (msRemaining / cycleMs);
      finalAmount = Math.max(1, finalAmount - prorationCredit);
    } else {
      finalAmount = Math.max(1, finalAmount);
    }

    const formattedAmount = finalAmount.toFixed(2);
    const key = process.env.PAYU_MERCHANT_KEY || "";
    const salt = process.env.PAYU_MERCHANT_SALT || "";
    const isTestMode = process.env.NODE_ENV !== "production";
    const payuAction = isTestMode
      ? "https://test.payu.in/_payment"
      : "https://secure.payu.in/_payment";

    // Check if an existing one exists for: userId + plan + billingCycle
    const existingPending = await PendingTransaction.findOne({
      userId: session.user.id,
      planSlug: planSlug ?? "",
      billingCycle,
    });

    let txnid: string;
    if (existingPending) {
      txnid = existingPending.txnid;
      // Update the existing record with new details
      existingPending.planName = planName;
      existingPending.storageLimitBytes = plan.storageLimitBytes;
      existingPending.planPriceINR = plan.priceINR;
      existingPending.couponId = couponId ?? undefined;
      existingPending.couponCode = validatedCouponCode ?? undefined;
      existingPending.couponDiscount = couponDiscount;
      existingPending.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      existingPending.paymentMethod = paymentMethod;
      existingPending.billingAddress = billingAddress ?? null;
      existingPending.expectedAmount = parseFloat(formattedAmount);
      await existingPending.save();
    } else {
      txnid = "TXN" + Date.now() + crypto.randomBytes(8).toString("hex");
      // Store BASE price (plan.priceINR — already campaign-adjusted) so the
      // success webhook can use it to compute subscription end date correctly.
      await PendingTransaction.create({
        txnid,
        userId: session.user.id,
        planName,
        planSlug: planSlug ?? "",
        storageLimitBytes: plan.storageLimitBytes,
        planPriceINR: plan.priceINR, // base for this cycle, campaign applied
        billingCycle,               // NEW — needed by success webhook
        ...(couponId ? { couponId } : {}),
        ...(validatedCouponCode ? { couponCode: validatedCouponCode } : {}),
        couponDiscount,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        paymentMethod,
        billingAddress: billingAddress ?? null,
        expectedAmount: parseFloat(formattedAmount),
      });
    }

    const productinfo = planName;
    const firstname = userDoc.name || session.user.name || "User";
    const email = session.user.email;
    const udf1 = session.user.id;

    const proto = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host");
    const baseUrl = `${proto}://${host}`;
    const surl = `${baseUrl}/api/payment/payu/success`;
    const furl = `${baseUrl}/api/payment/payu/failure`;

    let params: Record<string, string>;
    let hash: string;

    if (paymentMethod === "autopay") {
      const siDetails = {
        billingAmount: formattedAmount,
        billingCycle: PAYU_SI_CYCLE[billingCycle],
        billingInterval: 1,
        paymentStartDate: todayStr(),
        paymentEndDate: addPeriodStr(new Date(), billingCycle),
        remarks: `Xenode ${planName} ${billingCycle}`,
      };
      const siDetailsStr = JSON.stringify(siDetails);
      hash = forwardHash(key, salt, txnid, formattedAmount, productinfo, firstname, email, udf1, siDetailsStr);
      params = {
        key, txnid, amount: formattedAmount, productinfo,
        firstname, email, phone, udf1, surl, furl, hash,
        pg: "UPI", bankcode: "UPI", si: "1", si_details: siDetailsStr,
      };
    } else {
      hash = forwardHash(key, salt, txnid, formattedAmount, productinfo, firstname, email, udf1);
      params = { key, txnid, amount: formattedAmount, productinfo, firstname, email, phone, udf1, surl, furl, hash };
    }

    // Done handling PendingTransaction
    return NextResponse.json({
      action: payuAction,
      params,
      prorationCredit: Math.round(prorationCredit * 100) / 100,
      finalAmount: parseFloat(formattedAmount),
      couponApplied: couponId !== null,
      couponDiscount,
    });
  } catch (error) {
    console.error("PayU initialization error:", error);
    return NextResponse.json({ error: "Failed to initialize payment" }, { status: 500 });
  }
}
