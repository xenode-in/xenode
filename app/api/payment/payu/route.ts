import { NextResponse } from "next/server";
import crypto from "crypto";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import PendingTransaction from "@/models/PendingTransaction";
import mongoose from "mongoose";

/** Server-authoritative plan definitions.
 *  NEVER derive these from client input.
 */
const PLAN_CONFIG: Record<
  string,
  { storageLimitBytes: number; priceINR: number }
> = {
  "100GB Model": { storageLimitBytes: 100 * 1024 * 1024 * 1024, priceINR: 149 },
  "500GB Model": { storageLimitBytes: 500 * 1024 * 1024 * 1024, priceINR: 399 },
  "1TB Model":   { storageLimitBytes: 1024 * 1024 * 1024 * 1024, priceINR: 699 },
  "2TB Model":   { storageLimitBytes: 2 * 1024 * 1024 * 1024 * 1024, priceINR: 999 },
};

export async function POST(req: Request) {
  try {
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { planName } = await req.json();

    // Validate planName against server-authoritative allowlist
    const plan = PLAN_CONFIG[planName];
    if (!plan) {
      return NextResponse.json(
        { error: "Invalid plan selection" },
        { status: 400 },
      );
    }

    let finalAmount = plan.priceINR;

    await dbConnect();

    // Fetch user phone from profile (never hardcode)
    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");
    const userDoc = await db
      .collection("user")
      .findOne(
        { _id: new mongoose.Types.ObjectId(session.user.id) },
        { projection: { phone: 1 } },
      );
    const phone = userDoc?.phone || "";

    const currentUsage = await Usage.findOne({ userId: session.user.id });

    // --- PRORATION LOGIC (uses stored planPriceINR, not byte-matching) ---
    if (
      currentUsage &&
      currentUsage.plan !== "free" &&
      currentUsage.planExpiresAt &&
      currentUsage.planExpiresAt.getTime() > Date.now() &&
      currentUsage.planPriceINR > 0
    ) {
      const msRemaining =
        currentUsage.planExpiresAt.getTime() - Date.now();
      const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);
      const unusedValue = (currentUsage.planPriceINR / 30) * daysRemaining;
      finalAmount = Math.max(1, finalAmount - unusedValue);
    }

    const formattedAmount = finalAmount.toFixed(2);

    const key = process.env.PAYU_MERCHANT_KEY || "";
    const salt = process.env.PAYU_MERCHANT_SALT || "";

    const isTestMode = process.env.NODE_ENV !== "production";
    const payuAction = isTestMode
      ? "https://test.payu.in/_payment"
      : "https://secure.payu.in/_payment";

    // CVE-7: cryptographically secure txnid
    const txnid = "TXN" + Date.now() + crypto.randomBytes(8).toString("hex");

    const productinfo = planName;
    const firstname = session.user.name || "User";
    const email = session.user.email;
    const udf1 = session.user.id;

    const proto = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host");
    const baseUrl = `${proto}://${host}`;

    const surl = `${baseUrl}/api/payment/payu/success`;
    const furl = `${baseUrl}/api/payment/payu/failure`;

    const hashString = `${key}|${txnid}|${formattedAmount}|${productinfo}|${firstname}|${email}|${udf1}||||||||||${salt}`;
    const hash = crypto
      .createHash("sha512")
      .update(hashString)
      .digest("hex");

    // CVE-3: persist intended plan server-side with 1-hour TTL
    await PendingTransaction.create({
      txnid,
      userId: session.user.id,
      planName,
      storageLimitBytes: plan.storageLimitBytes,
      planPriceINR: plan.priceINR,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour TTL
    });

    const params = {
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

    return NextResponse.json({
      action: payuAction,
      params,
    });
  } catch (error) {
    console.error("PayU initialization error:", error);
    return NextResponse.json(
      { error: "Failed to initialize payment" },
      { status: 500 },
    );
  }
}
