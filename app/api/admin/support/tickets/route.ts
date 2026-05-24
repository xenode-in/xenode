import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin/session";
import { jsonError } from "@/lib/billing/http";
import { listAdminTickets } from "@/lib/support/tickets";
import type { TicketCategory, TicketStatus } from "@/models/SupportTicket";

const VALID_STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "awaiting_user",
  "resolved",
  "closed",
];
const VALID_CATEGORIES: TicketCategory[] = [
  "refund_request",
  "billing",
  "technical",
  "account",
  "general",
];

/**
 * GET /api/admin/support/tickets — admin inbox with filters.
 *
 * Filters: ?status, ?category, ?userId, ?search (subject/email/name),
 * ?limit, ?skip
 *
 * Response includes summary counts (open + urgent) for the inbox header.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sp = request.nextUrl.searchParams;
    const statusParam = sp.get("status");
    const categoryParam = sp.get("category");
    const status =
      statusParam && (VALID_STATUSES as readonly string[]).includes(statusParam)
        ? (statusParam as TicketStatus)
        : undefined;
    const category =
      categoryParam &&
      (VALID_CATEGORIES as readonly string[]).includes(categoryParam)
        ? (categoryParam as TicketCategory)
        : undefined;
    const userId = sp.get("userId") || undefined;
    const search = sp.get("search") || undefined;
    const limit = Math.min(Number(sp.get("limit") || 50), 200);
    const skip = Math.max(0, Number(sp.get("skip") || 0));

    const { rows, total, openCount, urgentCount } = await listAdminTickets({
      status,
      category,
      userId,
      search,
      limit,
      skip,
    });

    return NextResponse.json({
      total,
      openCount,
      urgentCount,
      rows: rows.map((t) => ({
        id: String(t._id),
        userId: t.userId,
        userEmail: t.userEmail,
        userName: t.userName,
        subject: t.subject,
        category: t.category,
        status: t.status,
        priority: t.priority,
        replyCount: t.replies?.length ?? 0,
        lastReplyAt: t.lastReplyAt,
        lastReplyBy: t.lastReplyBy,
        refundRequestId: t.refundRequestId ? String(t.refundRequestId) : null,
        assignedAdminId: t.assignedAdminId,
        createdAt: t.createdAt,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
