import { NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import Payment from "@/models/Payment";
import mongoose from "mongoose";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const data: Record<string, string> = {};
    formData.forEach((value, key) => {
      data[key] = value.toString();
    });

    const key = process.env.PAYU_MERCHANT_KEY || "";
    const salt = process.env.PAYU_MERCHANT_SALT || "";

    const {
      status,
      firstname,
      amount,
      txnid,
      hash: resHash,
      productinfo,
      email,
      udf1,
    } = data;

    // Hash sequence for response: SALT|status|||||||||||udf1|email|firstname|productinfo|amount|txnid|key
    const hashString = `${salt}|${status}||||||||||${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
    const calculatedHash = crypto
      .createHash("sha512")
      .update(hashString)
      .digest("hex");

    const redirectHtml = (url: string) => `
      <!DOCTYPE html>
      <html>
        <head>
          <meta http-equiv="refresh" content="0;url=${url}">
        </head>
        <body>
          <p>Redirecting...</p>
          <script>
            window.location.href = "${url}";
          </script>
        </body>
      </html>
    `;

    if (calculatedHash !== resHash && process.env.PAYU_TEST_MODE === "false") {
      return new NextResponse(
        redirectHtml(
          new URL("/dashboard/billing?error=hash_mismatch", req.url).toString(),
        ),
        { headers: { "Content-Type": "text/html" } },
      );
    }

    if (status === "success") {
      await dbConnect();

      // Find user by udf1 safely or fallback to email
      const db = mongoose.connection.db;
      if (!db) throw new Error("Database not connected");

      const query =
        udf1 && mongoose.Types.ObjectId.isValid(udf1)
          ? { _id: new mongoose.Types.ObjectId(udf1) }
          : { email };

      const user = await db.collection("user").findOne(query as any);

      if (user) {
        // Update user limits based on productinfo
        const planMap: Record<string, number> = {
          "100GB Model": 100 * 1024 * 1024 * 1024,
          "500GB Model": 500 * 1024 * 1024 * 1024,
          "1TB Model": 1024 * 1024 * 1024 * 1024,
          "2TB Model": 2 * 1024 * 1024 * 1024 * 1024,
        };

        const storageLimitBytes = planMap[productinfo] || 1099511627776;

        await Usage.findOneAndUpdate(
          { userId: user._id.toString() },
          {
            $set: {
              plan: "pro",
              storageLimitBytes,
              planActivatedAt: new Date(),
              planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          },
          { upsert: true },
        );

        // Record the successful payment
        await Payment.create({
          userId: user._id.toString(),
          amount: parseFloat(amount),
          currency: "INR",
          status: "success",
          txnid,
          planName: productinfo,
          payuResponse: data,
        });
      }

      return new NextResponse(
        redirectHtml(
          new URL("/dashboard/billing?success=true", req.url).toString(),
        ),
        { headers: { "Content-Type": "text/html" } },
      );
    }

    return new NextResponse(
      redirectHtml(
        new URL("/dashboard/billing?error=payment_failed", req.url).toString(),
      ),
      { headers: { "Content-Type": "text/html" } },
    );
  } catch (error) {
    console.error("PayU success callback error:", error);
    return new NextResponse(
      `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/dashboard/billing?error=server_error"></head><body><script>window.location.href="/dashboard/billing?error=server_error";</script></body></html>`,
      { headers: { "Content-Type": "text/html" } },
    );
  }
}
