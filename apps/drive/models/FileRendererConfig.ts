import mongoose, { type Document, type Model, Schema } from "mongoose";
import type { RendererKey } from "@/lib/file-security/types";

export interface IFileRendererConfig extends Document {
  key: "global";
  killed: Partial<Record<RendererKey | "global", boolean>>;
  version: number;
  reason: string;
  updatedByAdminId: string;
  updatedByUsername: string;
  createdAt: Date;
  updatedAt: Date;
}

const FileRendererConfigSchema = new Schema<IFileRendererConfig>(
  {
    key: { type: String, required: true, unique: true, default: "global" },
    killed: { type: Schema.Types.Mixed, required: true, default: {} },
    version: { type: Number, required: true, default: 1 },
    reason: { type: String, required: true, default: "Initial fail-closed state" },
    updatedByAdminId: { type: String, required: true, default: "system" },
    updatedByUsername: { type: String, required: true, default: "system" },
  },
  { timestamps: true },
);

const FileRendererConfig: Model<IFileRendererConfig> =
  mongoose.models.FileRendererConfig ||
  mongoose.model<IFileRendererConfig>(
    "FileRendererConfig",
    FileRendererConfigSchema,
  );

export default FileRendererConfig;
