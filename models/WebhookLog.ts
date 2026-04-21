import mongoose, { Schema, Document, Model } from "mongoose";

export interface IWebhookLog extends Document {
  eventId: string;
  eventType: string;
  gateway: "razorpay" | "payu" | "other";
  payload: any;
  status: "pending" | "processed" | "failed" | "ignored";
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookLogSchema = new Schema<IWebhookLog>(
  {
    eventId: { type: String, unique: true, sparse: true, index: true },
    eventType: { type: String, required: true, index: true },
    gateway: { type: String, required: true, enum: ["razorpay", "payu", "other"] },
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      required: true,
      enum: ["pending", "processed", "failed", "ignored"],
      default: "pending",
    },
    errorMessage: { type: String },
  },
  { timestamps: true }
);

// TTL index to automatically delete old logs after 90 days (7776000 seconds)
WebhookLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

const WebhookLog: Model<IWebhookLog> =
  mongoose.models.WebhookLog || mongoose.model<IWebhookLog>("WebhookLog", WebhookLogSchema);

export default WebhookLog;
