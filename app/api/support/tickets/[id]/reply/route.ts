import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { parseJson, jsonError } from "@/lib/billing/http";
import { addReply, getTicketForUser } from "@/lib/support/tickets";
import { notifyTicketReply } from "@/lib/email/notifications";

const replySchema = z.object({
  message: z.string().trim().min(1).max(8000),
});

/**
 * POST /api/support/tickets/[id]/reply — user posts a reply on their own ticket.
 *
 * Reopens awaiting_user/resolved tickets. Closed tickets cannot be replied to.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const ticket = await getTicketForUser(id, session.user.id);
    if (!ticket) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (ticket.status === "closed") {
      return NextResponse.json(
        { error: "Ticket is closed" },
        { status: 409 },
      );
    }

    const input = await parseJson(request, replySchema);

    const { reply } = await addReply({
      ticketId: id,
      authorType: "user",
      authorId: session.user.id,
      authorName: session.user.name || session.user.email.split("@")[0],
      message: input.message,
      isInternal: false,
    });

    await notifyTicketReply({
      userEmail: ticket.userEmail,
      userName: ticket.userName,
      subject: ticket.subject,
      ticketId: id,
      replyPreview: input.message,
      recipient: "admin",
    });

    return NextResponse.json({
      id: String(reply._id),
      authorType: reply.authorType,
      authorName: reply.authorName,
      message: reply.message,
      createdAt: reply.createdAt,
    });
  } catch (error) {
    return jsonError(error);
  }
}
