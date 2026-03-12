import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Payment from "@/models/Payment";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const data: Record<string, string> = {};
    formData.forEach((value, key) => {
      data[key] = value.toString();
    });

    console.error("Payment failed", data);

    const { amount, txnid, productinfo, udf1 } = data;

    if (udf1) {
      await dbConnect();
      try {
        await Payment.create({
          userId: udf1,
          amount: parseFloat(amount) || 0,
          currency: "INR",
          status: "failed",
          txnid: txnid || `failed-${Date.now()}`,
          planName: productinfo || "Unknown",
          payuResponse: data,
        });
      } catch (err) {
        console.error("Failed to save failed payment to DB", err);
      }
    }

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

    return new NextResponse(
      redirectHtml(
        new URL("/dashboard/billing?error=payment_failed", req.url).toString(),
      ),
      { headers: { "Content-Type": "text/html" } },
    );
  } catch (error) {
    console.error("PayU failure callback error:", error);
    return new NextResponse(
      `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/dashboard/billing?error=server_error"></head><body><script>window.location.href="/dashboard/billing?error=server_error";</script></body></html>`,
      { headers: { "Content-Type": "text/html" } },
    );
  }
}
