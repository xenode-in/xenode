import mongoose, { Schema, Document, Model } from "mongoose";

export enum MigrationFileStatus {
  PENDING = "PENDING",
  DOWNLOADING = "DOWNLOADING",
  UPLOADING = "UPLOADING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  SKIPPED = "SKIPPED",
}

export interface IMigrationFile extends Document {
  _id: mongoose.Types.ObjectId;
  migrationId: mongoose.Types.ObjectId;
  providerFileId: string;
  fileName: string;
  providerFolderPath: string; // The relative folder path (e.g., "Documents/Work")
  fileSize: number;
  mimeType: string;
  status: MigrationFileStatus;
  retryCount: number;
  errorMessage?: string;
  uploadedFileId?: mongoose.Types.ObjectId; // Reference to StorageObject once complete
  createdAt: Date;
  updatedAt: Date;
}

const MigrationFileSchema = new Schema<IMigrationFile>(
  {
    migrationId: { 
      type: Schema.Types.ObjectId, 
      ref: "MigrationJob", 
      required: true, 
      index: true 
    },
    providerFileId: { type: String, required: true },
    fileName: { type: String, required: true },
    providerFolderPath: { type: String, default: "" },
    fileSize: { type: Number, required: true },
    mimeType: { type: String, default: "application/octet-stream" },
    status: { 
      type: String, 
      enum: Object.values(MigrationFileStatus), 
      default: MigrationFileStatus.PENDING,
      index: true 
    },
    retryCount: { type: Number, default: 0 },
    errorMessage: { type: String },
    uploadedFileId: { type: Schema.Types.ObjectId, ref: "StorageObject" },
  },
  {
    timestamps: true,
  }
);

// Indexes
MigrationFileSchema.index({ migrationId: 1, status: 1 }); // Useful for resuming
MigrationFileSchema.index({ migrationId: 1, providerFileId: 1 }, { unique: true }); // Prevent duplicate scanning

const MigrationFile: Model<IMigrationFile> =
  mongoose.models.MigrationFile ||
  mongoose.model<IMigrationFile>("MigrationFile", MigrationFileSchema);

export default MigrationFile;
