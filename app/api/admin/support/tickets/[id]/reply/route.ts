import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSession } from "@/lib/admin/session";
import { parseJson, jsonError } from "@/lib/billing/http";
import { addReply, getTicketForAdmin } from "@/lib/support/tickets";
import { notifyTicketReply } from "@/lib/email/notifications";
import { emitBillingEvent } from "@/lib/billing/events";

const replySchema = z.object({
  message: z.string().trim().min(1).max(8000),
  isInternal: z.boolean().optional().default(false),
});

/**
 * POST /api/admin/support/tickets/[id]/reply — admin posts a reply or internal note.
 *
 * Internal notes (isInternal=true) are visible only to admins and do not email
 * the user. Public replies email the user.
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
    const ticket = await getTicketForAdmin(id);
    if (!ticket) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const input = await parseJson(request, replySchema);

    const { reply } = await addReply({
      ticketId: id,
      authorType: "admin",
      authorId: session.id,
      authorName: session.username,
      message: input.message,
      isInternal: input.isInternal,
    });

    if (!input.isInternal) {
      await notifyTicketReply({
        userEmail: ticket.userEmail,
        userName: ticket.userName,
        subject: ticket.subject,
        ticketId: id,
        replyPreview: input.message,
        recipient: "user",
      });
    }

    await emitBillingEvent({
      type: input.isInternal
        ? "support.ticket.internal_note"
        : "support.ticket.replied",
      userId: ticket.userId,
      actorType: "admin",
      actorId: session.id,
      subjectType: "ticket",
      subjectId: id,
      payload: {
        replyId: String(reply._id),
        isInternal: input.isInternal,
      },
    });

    return NextResponse.json({
      id: String(reply._id),
      authorType: reply.authorType,
      authorName: reply.authorName,
      message: reply.message,
      isInternal: reply.isInternal,
      createdAt: reply.createdAt,
    });
  } catch (error) {
    return jsonError(error);
  }
}
