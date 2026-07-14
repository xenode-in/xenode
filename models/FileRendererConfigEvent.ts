import mongoose, { type Document, type Model, Schema } from "mongoose";
import type { RendererKey } from "@/lib/file-security/types";

export interface IFileRendererConfigEvent extends Document {
  renderer: RendererKey | "global";
  killed: boolean;
  reason: string;
  actorAdminId: string;
  actorUsername: string;
  configVersion: number;
  createdAt: Date;
}

const FileRendererConfigEventSchema =
  new Schema<IFileRendererConfigEvent>(
    {
      renderer: { type: String, required: true, index: true },
      killed: { type: Boolean, required: true },
      reason: { type: String, required: true },
      actorAdminId: { type: String, required: true, index: true },
      actorUsername: { type: String, required: true },
      configVersion: { type: Number, required: true },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
  );

FileRendererConfigEventSchema.index({ createdAt: -1 });

const FileRendererConfigEvent: Model<IFileRendererConfigEvent> =
  mongoose.models.FileRendererConfigEvent ||
  mongoose.model<IFileRendererConfigEvent>(
    "FileRendererConfigEvent",
    FileRendererConfigEventSchema,
  );

export default FileRendererConfigEvent;
