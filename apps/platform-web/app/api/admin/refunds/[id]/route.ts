import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAdminSession } from "@/lib/admin/session";
import { jsonError } from "@/lib/billing/http";
import dbConnect from "@/lib/mongodb";
import RefundRequest from "@/models/RefundRequest";
import Payment from "@/models/Payment";
import SupportTicket from "@/models/SupportTicket";

/**
 * GET /api/admin/refunds/[id] — refund detail with linked payment + ticket.
 *
 * Used by the admin decision page to show all context in one place.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    await dbConnect();

    const refund = await RefundRequest.findById(id).lean();
    if (!refund) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [payment, ticket] = await Promise.all([
      Payment.findById(refund.paymentId).lean(),
      SupportTicket.findById(refund.ticketId).lean(),
    ]);

    return NextResponse.json({
      id: String(refund._id),
      userId: refund.userId,
      ticketId: String(refund.ticketId),
      razorpayPaymentId: refund.razorpayPaymentId,
      razorpaySubscriptionId: refund.razorpaySubscriptionId,
      amount: refund.amount,
      currency: refund.currency,
      reason: refund.reason,
      status: refund.status,
      eligibilityWindowEndsAt: refund.eligibilityWindowEndsAt,
      decidedBy: refund.decidedBy,
      decidedAt: refund.decidedAt,
      decisionNote: refund.decisionNote,
      razorpayRefundId: refund.razorpayRefundId,
      refundedAt: refund.refundedAt,
      failureReason: refund.failureReason,
      createdAt: refund.createdAt,
      payment: payment
        ? {
            id: String(payment._id),
            amount: payment.amount,
            currency: payment.currency,
            status: payment.status,
            planName: payment.planName,
            billingCycle: payment.billingCycle,
            method: payment.method,
            paidAt: payment.createdAt,
            subscriptionStartDate: payment.subscriptionStartDate,
            subscriptionEndDate: payment.subscriptionEndDate,
            refund_id: payment.refund_id,
            refund_status: payment.refund_status,
          }
        : null,
      ticket: ticket
        ? {
            id: String(ticket._id),
            subject: ticket.subject,
            status: ticket.status,
            userEmail: ticket.userEmail,
            userName: ticket.userName,
          }
        : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
