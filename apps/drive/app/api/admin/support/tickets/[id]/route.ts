import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSession } from "@/lib/admin/session";
import { parseJson, jsonError } from "@/lib/billing/http";
import {
  getTicketForAdmin,
  updateTicketStatus,
} from "@/lib/support/tickets";
import { emitBillingEvent } from "@/lib/billing/events";

const patchSchema = z.object({
  status: z
    .enum(["open", "in_progress", "awaiting_user", "resolved", "closed"])
    .optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
});

/**
 * GET   /api/admin/support/tickets/[id] — full ticket detail (incl. internal notes).
 * PATCH /api/admin/support/tickets/[id] — update status and/or priority.
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
    const ticket = await getTicketForAdmin(id);
    if (!ticket) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: String(ticket._id),
      userId: ticket.userId,
      userEmail: ticket.userEmail,
      userName: ticket.userName,
      subject: ticket.subject,
      description: ticket.description,
      category: ticket.category,
      status: ticket.status,
      priority: ticket.priority,
      refundRequestId: ticket.refundRequestId
        ? String(ticket.refundRequestId)
        : null,
      assignedAdminId: ticket.assignedAdminId,
      replies: ticket.replies.map((r) => ({
        id: String(r._id),
        authorType: r.authorType,
        authorName: r.authorName,
        authorId: r.authorId,
        message: r.message,
        isInternal: r.isInternal,
        createdAt: r.createdAt,
      })),
      createdAt: ticket.createdAt,
      lastReplyAt: ticket.lastReplyAt,
      lastReplyBy: ticket.lastReplyBy,
      resolvedAt: ticket.resolvedAt,
      resolvedBy: ticket.resolvedBy,
      closedAt: ticket.closedAt,
      metadata: ticket.metadata ?? {},
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const input = await parseJson(request, patchSchema);
    if (!input.status && !input.priority) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }

    const ticket = await getTicketForAdmin(id);
    if (!ticket) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let updated = ticket;
    if (input.status) {
      updated = await updateTicketStatus({
        ticketId: id,
        status: input.status,
        adminId: session.id,
        adminUsername: session.username,
      });
    }
    if (input.priority) {
      updated.priority = input.priority;
      await updated.save();
    }

    await emitBillingEvent({
      type: "support.ticket.updated",
      userId: ticket.userId,
      actorType: "admin",
      actorId: session.id,
      subjectType: "ticket",
      subjectId: id,
      payload: {
        status: input.status ?? null,
        priority: input.priority ?? null,
      },
    });

    return NextResponse.json({
      id: String(updated._id),
      status: updated.status,
      priority: updated.priority,
      resolvedAt: updated.resolvedAt,
      closedAt: updated.closedAt,
    });
  } catch (error) {
    return jsonError(error);
  }
}
