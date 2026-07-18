import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { parseJson, jsonError, BillingError } from "@/lib/billing/http";
import { createTicket, listUserTickets } from "@/lib/support/tickets";
import { notifyTicketCreated } from "@/lib/email/notifications";

/**
 * GET  /api/support/tickets — list current user's tickets
 * POST /api/support/tickets — create a new ticket
 *
 * Refund-category tickets are not allowed via this route — those flow through
 * /api/refunds/request which enforces the 14-day eligibility check first.
 */

const createTicketSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(8000),
  category: z.enum(["billing", "technical", "account", "general"]),
});

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sp = request.nextUrl.searchParams;
    const statusParam = sp.get("status");
    const allowed = ["open", "in_progress", "awaiting_user", "resolved", "closed"] as const;
    type Status = (typeof allowed)[number];
    const status =
      statusParam && (allowed as readonly string[]).includes(statusParam)
        ? (statusParam as Status)
        : undefined;
    const limit = Math.min(Number(sp.get("limit") || 50), 100);
    const skip = Math.max(0, Number(sp.get("skip") || 0));

    const { rows, total } = await listUserTickets({
      userId: session.user.id,
      status,
      limit,
      skip,
    });

    return NextResponse.json({
      total,
      rows: rows.map((t) => ({
        id: String(t._id),
        subject: t.subject,
        category: t.category,
        status: t.status,
        priority: t.priority,
        lastReplyAt: t.lastReplyAt,
        lastReplyBy: t.lastReplyBy,
        replyCount: t.replies?.length ?? 0,
        createdAt: t.createdAt,
        refundRequestId: t.refundRequestId ? String(t.refundRequestId) : null,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const input = await parseJson(request, createTicketSchema);

    const ticket = await createTicket({
      userId: session.user.id,
      userEmail: session.user.email,
      userName: session.user.name || session.user.email.split("@")[0],
      subject: input.subject,
      description: input.description,
      category: input.category,
    });

    // Fire-and-forget email — do not await externally; we do await here so any
    // synchronous setup error logs immediately, but Resend send is internally
    // try/catch-wrapped and never throws.
    await notifyTicketCreated({
      userEmail: ticket.userEmail,
      userName: ticket.userName,
      subject: ticket.subject,
      description: ticket.description,
      category: ticket.category,
      ticketId: String(ticket._id),
    });

    return NextResponse.json(
      {
        id: String(ticket._id),
        subject: ticket.subject,
        category: ticket.category,
        status: ticket.status,
        createdAt: ticket.createdAt,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof BillingError) return jsonError(error);
    return jsonError(error);
  }
}
