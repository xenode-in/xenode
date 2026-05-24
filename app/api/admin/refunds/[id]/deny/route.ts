import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSession } from "@/lib/admin/session";
import { parseJson, jsonError } from "@/lib/billing/http";
import { denyRefund } from "@/lib/refunds/processor";
import dbConnect from "@/lib/mongodb";
import RefundRequest from "@/models/RefundRequest";
import SupportTicket from "@/models/SupportTicket";
import { addReply, updateTicketStatus } from "@/lib/support/tickets";
import { notifyRefundDenied } from "@/lib/email/notifications";

const denySchema = z.object({
  reason: z.string().trim().min(5).max(2000),
});

/**
 * POST /api/admin/refunds/[id]/deny — admin denies the refund request.
 *
 * No money movement. Posts a system reply with the reason and sets ticket to
 * awaiting_user so the user can reply if they want to appeal.
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
    const input = await parseJson(request, denySchema);

    const result = await denyRefund({
      refundRequestId: id,
      adminId: session.id,
      adminUsername: session.username,
      reason: input.reason,
    });

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
          message: `Your refund request has been declined.\n\nReason: ${input.reason}\n\nIf you'd like to discuss this further, please reply on this ticket.`,
          isInternal: false,
        });
        await updateTicketStatus({
          ticketId: String(refund.ticketId),
          status: "awaiting_user",
          adminId: session.id,
          adminUsername: session.username,
        });

        await notifyRefundDenied({
          userEmail: ticket.userEmail,
          userName: ticket.userName,
          amount: refund.amount,
          currency: refund.currency,
          ticketId: String(refund.ticketId),
          reason: input.reason,
        });
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
