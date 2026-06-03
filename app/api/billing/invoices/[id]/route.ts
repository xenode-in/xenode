import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import SubscriptionInvoice from "@/models/SubscriptionInvoice";
import Subscription from "@/models/Subscription";
import { generateInvoicePdfBuffer } from "@/lib/billing/invoice-pdf";

/**
 * GET /api/billing/invoices/[id]
 *
 * Single invoice. Returns JSON by default. If ?format=pdf query parameter is
 * specified, generates and returns the filled, flattened PDF invoice file.
 * Owner-scoped via the subscription linkage.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(request);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;

  await dbConnect();
  const invoice = await SubscriptionInvoice.findById(id).lean();
  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sub = await Subscription.findOne({
    subscription_id: invoice.subscription_id,
  })
    .select("userId planSlug billingCycle")
    .lean();
  if (!sub || sub.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Check if PDF format is requested
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format");

  if (format === "pdf") {
    try {
      const pdfBuffer = await generateInvoicePdfBuffer(id, session.user.id);
      const invoiceNumber = invoice.number || `XEN-INV-${id}`;

      return new Response(pdfBuffer as any, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="invoice_${invoiceNumber}.pdf"`,
          "Content-Length": String(pdfBuffer.byteLength),
        },
      });
    } catch (err: any) {
      console.error("PDF generation error in API:", err);
      return NextResponse.json(
        { error: `Failed to generate PDF: ${err.message}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    id: invoice._id.toString(),
    number: invoice.number ?? null,
    paymentId: invoice.payment_id,
    subscriptionId: invoice.subscription_id,
    amount: invoice.amount,
    currency: "INR",
    status: invoice.status,
    billingDate: invoice.billing_date,
    plan: sub.planSlug,
    cycle: sub.billingCycle,
  });
}
