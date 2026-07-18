import mongoose, { Schema, Document, Model } from "mongoose";
import { connectLogsDB } from "@/lib/mongodb-logs";

export interface IApiLog extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string | null;
  method: string;
  endpoint: string;
  statusCode: number;
  durationMs: number;
  ip: string;
  userAgent: string;
  metadata: Record<string, unknown>;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ApiLogSchema = new Schema<IApiLog>(
  {
    userId: { type: String, default: null, index: true },
    method: { type: String, required: true },
    endpoint: { type: String, required: true, index: true },
    statusCode: { type: Number, required: true },
    durationMs: { type: Number, required: true },
    ip: { type: String, default: "unknown" },
    userAgent: { type: String, default: "unknown" },
    metadata: { type: Schema.Types.Mixed, default: {} },
    errorMessage: { type: String },
  },
  { timestamps: true }
);

// Auto-delete logs after 90 days
ApiLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });
// Compound indexes for common admin query patterns
ApiLogSchema.index({ userId: 1, createdAt: -1 });
ApiLogSchema.index({ endpoint: 1, statusCode: 1, createdAt: -1 });

let _model: Model<IApiLog> | null = null;

/**
 * Returns the ApiLog model bound to the logs DB connection.
 * Uses a module-level singleton — safe in Next.js (module cache persists per worker).
 */
export async function getApiLogModel(): Promise<Model<IApiLog>> {
  if (_model) return _model;
  const conn = await connectLogsDB();
  _model = conn.models.ApiLog ?? conn.model<IApiLog>("ApiLog", ApiLogSchema);
  return _model;
}
