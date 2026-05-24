import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import SupportTicket, {
  type ISupportTicket,
  type TicketCategory,
  type TicketPriority,
  type TicketReplyAuthorType,
  type TicketStatus,
} from "@/models/SupportTicket";

/**
 * Support ticket service — central business logic for ticket CRUD + replies.
 *
 * Route handlers stay thin: parse + authorize + delegate. Reply additions
 * touch lastReplyAt/lastReplyBy so the admin inbox sort-by-recent works
 * without aggregations.
 */

const PRIORITY_BY_CATEGORY: Record<TicketCategory, TicketPriority> = {
  refund_request: "high",
  billing: "normal",
  technical: "normal",
  account: "normal",
  general: "low",
};

interface CreateTicketArgs {
  userId: string;
  userEmail: string;
  userName: string;
  subject: string;
  description: string;
  category: TicketCategory;
  refundRequestId?: mongoose.Types.ObjectId | string | null;
  metadata?: Record<string, unknown>;
}

export async function createTicket(args: CreateTicketArgs): Promise<ISupportTicket> {
  await dbConnect();
  const priority = PRIORITY_BY_CATEGORY[args.category];

  const ticket = await SupportTicket.create({
    userId: args.userId,
    userEmail: args.userEmail,
    userName: args.userName,
    subject: args.subject.trim(),
    description: args.description.trim(),
    category: args.category,
    status: "open",
    priority,
    refundRequestId: args.refundRequestId ?? null,
    replies: [],
    lastReplyAt: new Date(),
    lastReplyBy: "user",
    metadata: args.metadata ?? {},
  });

  return ticket;
}

interface AddReplyArgs {
  ticketId: string;
  authorType: TicketReplyAuthorType;
  authorId: string;
  authorName: string;
  message: string;
  isInternal?: boolean;
}

export async function addReply(
  args: AddReplyArgs,
): Promise<{ ticket: ISupportTicket; reply: ISupportTicket["replies"][number] }> {
  await dbConnect();
  const ticket = await SupportTicket.findById(args.ticketId);
  if (!ticket) {
    throw new Error("Ticket not found");
  }
  if (ticket.status === "closed") {
    throw new Error("Ticket is closed");
  }

  const reply = {
    _id: new mongoose.Types.ObjectId(),
    authorType: args.authorType,
    authorId: args.authorId,
    authorName: args.authorName,
    message: args.message.trim(),
    isInternal: args.isInternal ?? false,
    createdAt: new Date(),
  };

  ticket.replies.push(reply as ISupportTicket["replies"][number]);

  // Public replies update last-reply tracking and status; internal admin notes
  // do not (so the user-facing inbox stays accurate).
  if (!reply.isInternal) {
    ticket.lastReplyAt = reply.createdAt;
    ticket.lastReplyBy = args.authorType;

    if (args.authorType === "admin") {
      ticket.status = "awaiting_user";
    } else if (args.authorType === "user") {
      // User replied to an awaiting/resolved ticket → reopen.
      if (ticket.status === "awaiting_user" || ticket.status === "resolved") {
        ticket.status = "in_progress";
      } else if (ticket.status === "open") {
        ticket.status = "in_progress";
      }
    }
  }

  await ticket.save();
  return { ticket, reply: reply as ISupportTicket["replies"][number] };
}

interface UpdateStatusArgs {
  ticketId: string;
  status: TicketStatus;
  adminId: string;
  adminUsername: string;
}

export async function updateTicketStatus(
  args: UpdateStatusArgs,
): Promise<ISupportTicket> {
  await dbConnect();
  const ticket = await SupportTicket.findById(args.ticketId);
  if (!ticket) throw new Error("Ticket not found");

  const wasResolvedOrClosed =
    ticket.status === "resolved" || ticket.status === "closed";
  const isResolvedOrClosed =
    args.status === "resolved" || args.status === "closed";

  ticket.status = args.status;

  if (!wasResolvedOrClosed && isResolvedOrClosed) {
    if (args.status === "resolved") {
      ticket.resolvedAt = new Date();
      ticket.resolvedBy = args.adminUsername;
    }
    if (args.status === "closed") {
      ticket.closedAt = new Date();
      if (!ticket.resolvedAt) {
        ticket.resolvedAt = new Date();
        ticket.resolvedBy = args.adminUsername;
      }
    }
  }

  if (args.status === "in_progress" && !ticket.assignedAdminId) {
    ticket.assignedAdminId = args.adminId;
  }

  await ticket.save();
  return ticket;
}

interface ListUserTicketsArgs {
  userId: string;
  status?: TicketStatus;
  limit?: number;
  skip?: number;
}

export async function listUserTickets(args: ListUserTicketsArgs) {
  await dbConnect();
  const query: Record<string, unknown> = { userId: args.userId };
  if (args.status) query.status = args.status;

  const limit = Math.min(args.limit ?? 50, 100);
  const skip = args.skip ?? 0;

  const [rows, total] = await Promise.all([
    SupportTicket.find(query)
      .sort({ lastReplyAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SupportTicket.countDocuments(query),
  ]);

  return { rows, total };
}

interface ListAdminTicketsArgs {
  status?: TicketStatus;
  category?: TicketCategory;
  userId?: string;
  search?: string;
  limit?: number;
  skip?: number;
}

export async function listAdminTickets(args: ListAdminTicketsArgs) {
  await dbConnect();
  const query: Record<string, unknown> = {};
  if (args.status) query.status = args.status;
  if (args.category) query.category = args.category;
  if (args.userId) query.userId = args.userId;
  if (args.search) {
    const re = new RegExp(escapeRegex(args.search), "i");
    query.$or = [{ subject: re }, { userEmail: re }, { userName: re }];
  }

  const limit = Math.min(args.limit ?? 50, 200);
  const skip = args.skip ?? 0;

  const [rows, total, openCount, urgentCount] = await Promise.all([
    SupportTicket.find(query)
      .sort({ lastReplyAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SupportTicket.countDocuments(query),
    SupportTicket.countDocuments({
      status: { $in: ["open", "in_progress"] },
    }),
    SupportTicket.countDocuments({
      status: { $in: ["open", "in_progress"] },
      priority: { $in: ["high", "urgent"] },
    }),
  ]);

  return { rows, total, openCount, urgentCount };
}

export async function getTicketForUser(
  ticketId: string,
  userId: string,
): Promise<ISupportTicket | null> {
  if (!mongoose.Types.ObjectId.isValid(ticketId)) return null;
  await dbConnect();
  const ticket = await SupportTicket.findOne({ _id: ticketId, userId });
  if (!ticket) return null;
  // Strip internal admin replies — users never see them.
  ticket.replies = ticket.replies.filter((r) => !r.isInternal);
  return ticket;
}

export async function getTicketForAdmin(
  ticketId: string,
): Promise<ISupportTicket | null> {
  if (!mongoose.Types.ObjectId.isValid(ticketId)) return null;
  await dbConnect();
  return SupportTicket.findById(ticketId);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
