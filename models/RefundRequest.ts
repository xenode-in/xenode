import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * RefundRequest — admin-reviewable refund record.
 *
 * Always linked to a SupportTicket (the user-facing thread) and a Payment.
 * Lifecycle:
 *   pending  → admin reviews (ticket is "open"/"in_progress")
 *   approved → admin clicks "Process" → calls Razorpay refund API
 *   processing → Razorpay accepted, awaiting refund.processed webhook
 *   completed  → refund.processed webhook fired, Payment.status = "refunded"
 *   denied   → admin rejected, no money movement
 *   failed   → Razorpay API call failed or refund.failed webhook
 *
 * Idempotency: razorpayRefundId is unique-sparse so retries can't double-refund.
 */

export type RefundStatus =
  | "pending"
  | "approved"
  | "processing"
  | "completed"
  | "denied"
  | "failed";

export interface IRefundRequest extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  ticketId: mongoose.Types.ObjectId;
  paymentId: mongoose.Types.ObjectId;
  /** Razorpay payment_id for the refund API call */
  razorpayPaymentId: string;
  subscriptionId?: mongoose.Types.ObjectId | null;
  razorpaySubscriptionId?: string | null;
  amount: number;
  currency: string;
  reason: string;
  status: RefundStatus;
  /** Set at creation — locks the 14-day window for audit */
  eligibilityWindowEndsAt: Date;
  decidedBy?: string | null;
  decidedAt?: Date | null;
  decisionNote?: string | null;
  razorpayRefundId?: string | null;
  refundedAt?: Date | null;
  failureReason?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const RefundRequestSchema = new Schema<IRefundRequest>(
  {
    userId: { type: String, required: true, index: true },
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "SupportTicket",
      required: true,
      index: true,
    },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      required: true,
      index: true,
    },
    razorpayPaymentId: { type: String, required: true, index: true },
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: "Subscription",
      default: null,
    },
    razorpaySubscriptionId: { type: String, default: null },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    reason: { type: String, required: true, maxlength: 2000 },
    status: {
      type: String,
      enum: [
        "pending",
        "approved",
        "processing",
        "completed",
        "denied",
        "failed",
      ],
      default: "pending",
      index: true,
    },
    eligibilityWindowEndsAt: { type: Date, required: true },
    decidedBy: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: null },
    razorpayRefundId: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
    },
    refundedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

RefundRequestSchema.index({ status: 1, createdAt: -1 });
RefundRequestSchema.index({ userId: 1, status: 1 });

const RefundRequest: Model<IRefundRequest> =
  mongoose.models.RefundRequest ||
  mongoose.model<IRefundRequest>("RefundRequest", RefundRequestSchema);

export default RefundRequest;
