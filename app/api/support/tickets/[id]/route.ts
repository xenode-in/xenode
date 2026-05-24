import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { jsonError } from "@/lib/billing/http";
import { getTicketForUser } from "@/lib/support/tickets";

/**
 * GET /api/support/tickets/[id] — single ticket detail for the owning user.
 *
 * Replies are pre-filtered to exclude isInternal admin notes.
 */
export async function GET(
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

    return NextResponse.json({
      id: String(ticket._id),
      subject: ticket.subject,
      description: ticket.description,
      category: ticket.category,
      status: ticket.status,
      priority: ticket.priority,
      refundRequestId: ticket.refundRequestId
        ? String(ticket.refundRequestId)
        : null,
      replies: ticket.replies.map((r) => ({
        id: String(r._id),
        authorType: r.authorType,
        authorName: r.authorName,
        message: r.message,
        createdAt: r.createdAt,
      })),
      createdAt: ticket.createdAt,
      lastReplyAt: ticket.lastReplyAt,
      lastReplyBy: ticket.lastReplyBy,
    });
  } catch (error) {
    return jsonError(error);
  }
}
