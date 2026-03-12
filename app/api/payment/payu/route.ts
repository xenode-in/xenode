import { NextResponse } from "next/server";
import crypto from "crypto";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";

export async function POST(req: Request) {
  try {
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { amount, planName } = await req.json();
    let finalAmount = parseFloat(amount);

    if (isNaN(finalAmount) || finalAmount <= 0 || !planName) {
      return NextResponse.json(
        { error: "Amount and plan details are required" },
        { status: 400 },
      );
    }

    await dbConnect();
    const currentUsage = await Usage.findOne({ userId: session.user.id });

    // --- DISCOUNT PRORATION LOGIC ---
    // If the user is on a paid plan and it hasn't expired yet, apply discount
    if (
      currentUsage &&
      currentUsage.plan !== "free" &&
      currentUsage.planExpiresAt &&
      currentUsage.planExpiresAt.getTime() > Date.now()
    ) {
      const msRemaining = currentUsage.planExpiresAt.getTime() - Date.now();
      const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);

      // Identify the cost of their OLD plan
      let oldPlanCost = 149; // fallback
      if (currentUsage.storageLimitBytes === 2 * 1024 * 1024 * 1024 * 1024)
        oldPlanCost = 999;
      else if (currentUsage.storageLimitBytes === 1024 * 1024 * 1024 * 1024)
        oldPlanCost = 699;
      else if (currentUsage.storageLimitBytes === 500 * 1024 * 1024 * 1024)
        oldPlanCost = 399;

      // Find the unused monetary value of their old plan
      const unusedValue = (oldPlanCost / 30) * daysRemaining;

      // Subtract unused value from the new plan cost
      finalAmount = finalAmount - unusedValue;

      // PayU requires amount > 0. If discount covers whole new plan, charge minimum ₹1
      // (in a real app, you might bypass the payment gateway entirely, but PayU requires a float)
      finalAmount = Math.max(1, finalAmount);
    }

    // Format to 2 decimal places to satisfy PayU requirements
    const formattedAmount = finalAmount.toFixed(2);

    const key = process.env.PAYU_MERCHANT_KEY || "";
    const salt = process.env.PAYU_MERCHANT_SALT || "";

    // PayU Test URL or Production URL based on env
    const isTestMode = process.env.PAYU_TEST_MODE !== "false";
    const payuAction = isTestMode
      ? "https://test.payu.in/_payment"
      : "https://secure.payu.in/_payment";

    const txnid = "TXN" + Date.now() + Math.floor(Math.random() * 1000);
    const productinfo = planName;
    const firstname = session.user.name || "User";
    const email = session.user.email;
    const phone = "9999999999";

    const proto = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host");
    const baseUrl = `${proto}://${host}`;

    const surl = `${baseUrl}/api/payment/payu/success`;
    const furl = `${baseUrl}/api/payment/payu/failure`;
    const udf1 = session.user.id;

    // Hash sequence: key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT
    const hashString = `${key}|${txnid}|${formattedAmount}|${productinfo}|${firstname}|${email}|${udf1}||||||||||${salt}`;
    const hash = crypto.createHash("sha512").update(hashString).digest("hex");

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
