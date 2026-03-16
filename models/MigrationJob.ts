import mongoose, { Schema, Document, Model } from "mongoose";

export enum MigrationStatus {
  CREATED = "CREATED",
  SCANNING = "SCANNING",
  QUEUED = "QUEUED",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

export enum ProviderType {
  GOOGLE_DRIVE = "GOOGLE_DRIVE",
  ONEDRIVE = "ONEDRIVE",
}

export interface IMigrationJob extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string; // Internal Xenode User ID
  provider: ProviderType;
  providerAccountId: string; // The ID of the linked account in Better Auth
  destinationBucketId: mongoose.Types.ObjectId; // Where files will go
  destinationPath: string; // Base folder path to migrate to (e.g. "rootPrefix/Migrations")
  sourceFolderId: string; // Root folder ID from provider ("root" for entirely)
  status: MigrationStatus;
  
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  
  totalBytes: number;
  migratedBytes: number;
  
  createdAt: Date;
  updatedAt: Date;
}

const MigrationJobSchema = new Schema<IMigrationJob>(
  {
    userId: { type: String, required: true, index: true },
    provider: { 
      type: String, 
      enum: Object.values(ProviderType), 
      required: true 
    },
    providerAccountId: { type: String, required: true },
    destinationBucketId: { 
      type: Schema.Types.ObjectId, 
      ref: "Bucket", 
      required: true 
    },
    destinationPath: { type: String, default: "" },
    sourceFolderId: { type: String, required: true },
    status: { 
      type: String, 
      enum: Object.values(MigrationStatus), 
      default: MigrationStatus.CREATED,
      index: true
    },
    totalFiles: { type: Number, default: 0 },
    processedFiles: { type: Number, default: 0 },
    failedFiles: { type: Number, default: 0 },
    totalBytes: { type: Number, default: 0 },
    migratedBytes: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

MigrationJobSchema.index({ userId: 1, createdAt: -1 });

const MigrationJob: Model<IMigrationJob> =
  mongoose.models.MigrationJob ||
  mongoose.model<IMigrationJob>("MigrationJob", MigrationJobSchema);

export default MigrationJob;
