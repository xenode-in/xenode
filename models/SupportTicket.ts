import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * SupportTicket — user-facing support and refund-request channel.
 *
 * Every refund request lives inside a ticket (category = "refund_request").
 * General billing/technical/account questions also flow through here so admins
 * have one inbox.
 *
 * Replies are embedded for atomic reads — a ticket detail page only needs one
 * query. Auth is enforced at the route layer (user can read own; admin can
 * read all).
 */

export type TicketCategory =
  | "refund_request"
  | "billing"
  | "technical"
  | "account"
  | "general";

export type TicketStatus =
  | "open"
  | "in_progress"
  | "awaiting_user"
  | "resolved"
  | "closed";

export type TicketPriority = "low" | "normal" | "high" | "urgent";

export type TicketReplyAuthorType = "user" | "admin" | "system";

export interface ITicketReply {
  _id: mongoose.Types.ObjectId;
  authorType: TicketReplyAuthorType;
  authorId: string;
  authorName: string;
  message: string;
  isInternal: boolean;
  createdAt: Date;
}

export interface ISupportTicket extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  userEmail: string;
  userName: string;
  subject: string;
  description: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  refundRequestId?: mongoose.Types.ObjectId | null;
  replies: ITicketReply[];
  assignedAdminId?: string | null;
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
  closedAt?: Date | null;
  lastReplyAt: Date;
  lastReplyBy: TicketReplyAuthorType;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const TicketReplySchema = new Schema<ITicketReply>(
  {
    authorType: {
      type: String,
      enum: ["user", "admin", "system"],
      required: true,
    },
    authorId: { type: String, required: true },
    authorName: { type: String, required: true },
    message: { type: String, required: true, maxlength: 8000 },
    isInternal: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const SupportTicketSchema = new Schema<ISupportTicket>(
  {
    userId: { type: String, required: true, index: true },
    userEmail: { type: String, required: true },
    userName: { type: String, required: true },
    subject: { type: String, required: true, maxlength: 200 },
    description: { type: String, required: true, maxlength: 8000 },
    category: {
      type: String,
      enum: ["refund_request", "billing", "technical", "account", "general"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "awaiting_user", "resolved", "closed"],
      default: "open",
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    refundRequestId: {
      type: Schema.Types.ObjectId,
      ref: "RefundRequest",
      default: null,
      index: true,
    },
    replies: { type: [TicketReplySchema], default: [] },
    assignedAdminId: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: null },
    closedAt: { type: Date, default: null },
    lastReplyAt: { type: Date, default: Date.now, index: true },
    lastReplyBy: {
      type: String,
      enum: ["user", "admin", "system"],
      default: "user",
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

SupportTicketSchema.index({ userId: 1, status: 1 });
SupportTicketSchema.index({ status: 1, lastReplyAt: -1 });
SupportTicketSchema.index({ category: 1, status: 1 });

const SupportTicket: Model<ISupportTicket> =
  mongoose.models.SupportTicket ||
  mongoose.model<ISupportTicket>("SupportTicket", SupportTicketSchema);

export default SupportTicket;
