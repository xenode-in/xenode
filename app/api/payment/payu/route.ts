import { NextResponse } from "next/server";
import crypto from "crypto";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import PendingTransaction from "@/models/PendingTransaction";
import mongoose from "mongoose";
import { PLAN_CONFIG } from "@/lib/config/plans";

const PHONE_RE = /^[6-9]\d{9}$/;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addYearStr(date: Date) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Build PayU forward hash string.
 *
 * Regular (one-time):
 *   key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT
 *
 * SI / UPI Autopay (per PayU docs):
 *   key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||si_details|SALT
 *
 * udf2–udf5 are empty strings; the 6 trailing pipes represent
 * additional_charges and 5 reserved fields — all empty.
 */
function buildForwardHash(
  key: string,
  salt: string,
  txnid: string,
  amount: string,
  productinfo: string,
  firstname: string,
  email: string,
  udf1: string,
  siDetailsStr?: string,
): string {
  const base = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udf1}||||||||||||${salt}`;

  // For SI: insert si_details between the trailing pipes and SALT
  // Formula: key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||si_details|SALT
  // Breakdown after email: |udf1|''|''|''|''||||||  = udf1 + udf2 + udf3 + udf4 + udf5 + 6 empty = 10 pipes after udf1
  const udfAndPipes = `${udf1}|||||||||`; // udf1|udf2|udf3|udf4|udf5||||||  (udf2-5 empty, then 5 more empty fields)

  if (siDetailsStr) {
    const hashStr = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udfAndPipes}|${siDetailsStr}|${salt}`;
    return crypto.createHash("sha512").update(hashStr).digest("hex");
  }

  const hashStr = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udfAndPipes}|${salt}`;
  return crypto.createHash("sha512").update(hashStr).digest("hex");
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
      paymentMethod = "direct",
      phone: clientPhone,
      billingAddress,
    } = body;

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
        { status: 400 },
      );
    }

    let finalAmount = plan.priceINR;
    let prorationCredit = 0;

    await dbConnect();

    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");

    const userDoc = await db
      .collection("user")
      .findOne(
        { _id: new mongoose.Types.ObjectId(session.user.id) },
        { projection: { name: 1, email: 1 } },
      );

    if (!userDoc) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const currentUsage = await Usage.findOne({ userId: session.user.id });

    if (
      currentUsage &&
      currentUsage.plan !== "free" &&
      currentUsage.planExpiresAt &&
      currentUsage.planExpiresAt.getTime() > Date.now() &&
      currentUsage.planPriceINR > 0
    ) {
      const msRemaining = currentUsage.planExpiresAt.getTime() - Date.now();
      const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);
      prorationCredit = (currentUsage.planPriceINR / 30) * daysRemaining;
      finalAmount = Math.max(1, finalAmount - prorationCredit);
    }

    const formattedAmount = finalAmount.toFixed(2);
    const key  = process.env.PAYU_MERCHANT_KEY  || "";
    const salt = process.env.PAYU_MERCHANT_SALT || "";

    const isTestMode = process.env.NODE_ENV !== "production";
    const payuAction = isTestMode
      ? "https://test.payu.in/_payment"
      : "https://secure.payu.in/_payment";

    const txnid      = "TXN" + Date.now() + crypto.randomBytes(8).toString("hex");
    const productinfo = planName;
    const firstname   = userDoc.name || session.user.name || "User";
    const email       = session.user.email;
    const udf1        = session.user.id;

    const proto   = req.headers.get("x-forwarded-proto") || "http";
    const host    = req.headers.get("host");
    const baseUrl = `${proto}://${host}`;
    const surl    = `${baseUrl}/api/payment/payu/success`;
    const furl    = `${baseUrl}/api/payment/payu/failure`;

    let siDetails: object | null = null;
    let params: Record<string, string>;
    let hash: string;

    if (paymentMethod === "autopay") {
      siDetails = {
        billingAmount: formattedAmount,
        billingCycle: "MONTHLY",
        billingInterval: 1,
        paymentStartDate: todayStr(),
        paymentEndDate: addYearStr(new Date()),
        remarks: `Xenode ${planName} monthly`,
      };
      const siDetailsStr = JSON.stringify(siDetails);

      // Correct SI forward hash:
      // key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||si_details|SALT
      hash = buildForwardHash(key, salt, txnid, formattedAmount, productinfo, firstname, email, udf1, siDetailsStr);

      params = {
        key,
        txnid,
        amount: formattedAmount,
        productinfo,
        firstname,
        email,
        phone,
        udf1,
        surl,
        furl,
        hash,
        pg: "UPI",
        bankcode: "UPI",
        si: "1",
        si_details: siDetailsStr,
      };
    } else {
      // Correct regular forward hash:
      // key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT
      hash = buildForwardHash(key, salt, txnid, formattedAmount, productinfo, firstname, email, udf1);

      params = {
        key,
        txnid,
        amount: formattedAmount,
        productinfo,
        firstname,
        email,
        phone,
        udf1,
        surl,
        furl,
        hash,
      };
    }

    await PendingTransaction.create({
      txnid,
      userId: session.user.id,
      planName,
      storageLimitBytes: plan.storageLimitBytes,
      planPriceINR: plan.priceINR,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      paymentMethod,
      siDetails,
      billingAddress: billingAddress ?? null,
    });

    return NextResponse.json({
      action: payuAction,
      params,
      prorationCredit: Math.round(prorationCredit * 100) / 100,
      finalAmount: parseFloat(formattedAmount),
    });
  } catch (error) {
    console.error("PayU initialization error:", error);
    return NextResponse.json({ error: "Failed to initialize payment" }, { status: 500 });
  }
}
