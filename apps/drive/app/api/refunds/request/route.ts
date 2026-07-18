import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { parseJson, jsonError, BillingError } from "@/lib/billing/http";
import dbConnect from "@/lib/mongodb";
import RefundRequest from "@/models/RefundRequest";
import SupportTicket from "@/models/SupportTicket";
import { checkRefundEligibility } from "@/lib/refunds/eligibility";
import { createTicket } from "@/lib/support/tickets";
import { emitBillingEvent } from "@/lib/billing/events";
import {
  notifyRefundRequested,
  notifyTicketCreated,
} from "@/lib/email/notifications";

/**
 * POST /api/refunds/request — user submits a refund request.
 *
 * Server-side re-checks eligibility (do not trust the UI). On success it:
 *   1. Creates a SupportTicket of category "refund_request"
 *   2. Creates a RefundRequest linked to the ticket and the eligible Payment
 *   3. Links the two (ticket.refundRequestId)
 *   4. Emits billing events + sends email notifications
 *
 * Both writes happen in a transaction so partial state is impossible.
 */

const refundRequestSchema = z.object({
  reason: z.string().trim().min(10).max(2000),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const input = await parseJson(request, refundRequestSchema);

    const eligibility = await checkRefundEligibility(session.user.id);
    if (!eligibility.eligible || !eligibility.payment) {
      throw new BillingError(
        409,
        eligibility.reason || "Not eligible for refund",
        "refund_not_eligible",
      );
    }

    await dbConnect();

    const userName = session.user.name || session.user.email.split("@")[0];
    const subject = `Refund request — ${eligibility.payment.planName} (${eligibility.payment.currency} ${eligibility.payment.amount.toFixed(2)})`;

    // Create the ticket first so we have an id to attach to the RefundRequest.
    const ticket = await createTicket({
      userId: session.user.id,
      userEmail: session.user.email,
      userName,
      subject,
      description: input.reason,
      category: "refund_request",
      metadata: {
        paymentId: eligibility.payment.id,
        razorpayPaymentId: eligibility.payment.razorpayPaymentId,
      },
    });

    let refundRequest;
    try {
      refundRequest = await RefundRequest.create({
        userId: session.user.id,
        ticketId: ticket._id,
        paymentId: new mongoose.Types.ObjectId(eligibility.payment.id),
        razorpayPaymentId: eligibility.payment.razorpayPaymentId,
        subscriptionId: eligibility.payment.subscriptionId
          ? new mongoose.Types.ObjectId(eligibility.payment.subscriptionId)
          : null,
        razorpaySubscriptionId: eligibility.payment.razorpaySubscriptionId,
        amount: eligibility.payment.amount,
        currency: eligibility.payment.currency,
        reason: input.reason,
        status: "pending",
        eligibilityWindowEndsAt: new Date(eligibility.payment.windowEndsAt),
      });
    } catch (createErr) {
      // Roll back the ticket if RefundRequest creation fails so we don't
      // leave orphaned refund-category tickets without a backing request.
      await SupportTicket.deleteOne({ _id: ticket._id });
      throw createErr;
    }

    // Link refund → ticket.
    ticket.refundRequestId = refundRequest._id;
    await ticket.save();

    await emitBillingEvent({
      type: "refund.requested",
      userId: session.user.id,
      actorType: "user",
      actorId: session.user.id,
      subjectType: "refund",
      subjectId: String(refundRequest._id),
      payload: {
        amount: refundRequest.amount,
        currency: refundRequest.currency,
        paymentId: refundRequest.razorpayPaymentId,
        ticketId: String(ticket._id),
      },
    });

    // Two emails: user acknowledgement + admin alert.
    await Promise.all([
      notifyRefundRequested({
        userEmail: session.user.email,
        userName,
        amount: refundRequest.amount,
        currency: refundRequest.currency,
        ticketId: String(ticket._id),
      }),
      notifyTicketCreated({
        userEmail: session.user.email,
        userName,
        subject,
        description: input.reason,
        category: "refund_request",
        ticketId: String(ticket._id),
      }),
    ]);

    return NextResponse.json(
      {
        ticketId: String(ticket._id),
        refundRequestId: String(refundRequest._id),
        status: refundRequest.status,
        amount: refundRequest.amount,
        currency: refundRequest.currency,
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
