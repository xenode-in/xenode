import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSession } from "@/lib/admin/session";
import { parseJson, jsonError } from "@/lib/billing/http";
import { initiateRefund } from "@/lib/refunds/processor";
import dbConnect from "@/lib/mongodb";
import RefundRequest from "@/models/RefundRequest";
import SupportTicket from "@/models/SupportTicket";
import { addReply, updateTicketStatus } from "@/lib/support/tickets";
import { notifyRefundApproved } from "@/lib/email/notifications";

const approveSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});

/**
 * POST /api/admin/refunds/[id]/approve — admin approves and initiates the refund.
 *
 * Calls Razorpay refund API via lib/refunds/processor → updates RefundRequest +
 * Payment state, cancels underlying subscription. Posts a system reply to the
 * linked ticket and emails the user.
 *
 * Idempotent: re-running on a request already processing/completed is a no-op
 * that returns the current state.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const input = await parseJson(request, approveSchema);

    const result = await initiateRefund({
      refundRequestId: id,
      adminId: session.id,
      adminUsername: session.username,
      decisionNote: input.note,
    });

    // Post a system reply on the ticket so the user sees the outcome inline,
    // and bump status to in_progress (refund settles in 5-7 days).
    await dbConnect();
    const refund = await RefundRequest.findById(id).lean();
    if (refund) {
      const ticket = await SupportTicket.findById(refund.ticketId);
      if (ticket && ticket.status !== "closed") {
        await addReply({
          ticketId: String(refund.ticketId),
          authorType: "system",
          authorId: "system",
          authorName: "Xenode Refunds",
          message: `Your refund of ${refund.currency} ${refund.amount.toFixed(2)} has been approved. Funds typically arrive in 5-7 business days. Your subscription has been cancelled.`,
          isInternal: false,
        });
        await updateTicketStatus({
          ticketId: String(refund.ticketId),
          status: "in_progress",
          adminId: session.id,
          adminUsername: session.username,
        });

        await notifyRefundApproved({
          userEmail: ticket.userEmail,
          userName: ticket.userName,
          amount: refund.amount,
          currency: refund.currency,
          ticketId: String(refund.ticketId),
        });
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
