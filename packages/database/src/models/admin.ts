import { Schema, type Types } from "mongoose";
import { getModel } from "../model";

export type AdminRole = "super_admin" | "admin";

/** Separate operator identity; never an Accounts user or ProductSession. */
export interface AdminRecord {
  _id: Types.ObjectId;
  username: string;
  passwordHash: string;
  role: AdminRole;
  isActive: boolean;
  sessionVersion: number;
  createdBy?: string;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const adminSchema = new Schema<AdminRecord>({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["super_admin", "admin"], required: true, default: "admin" },
  isActive: { type: Boolean, required: true, default: true },
  sessionVersion: { type: Number, required: true, default: 1, min: 1, validate: Number.isSafeInteger },
  createdBy: String,
  lastLoginAt: Date,
}, { timestamps: true, collection: "admins" });
adminSchema.index({ role: 1 });

export const Admin = getModel<AdminRecord>("Admin", adminSchema);
