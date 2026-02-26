import mongoose, { Schema, Document, Model } from "mongoose";
import bcrypt from "bcryptjs";

export type AdminRole = "super_admin" | "admin";

export interface IAdmin extends Document {
  _id: mongoose.Types.ObjectId;
  username: string;
  passwordHash: string;
  role: AdminRole;
  createdBy?: string; // username of the creator (super_admin)
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(plain: string): Promise<boolean>;
}

const AdminSchema = new Schema<IAdmin>(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      required: [true, "Password is required"],
    },
    role: {
      type: String,
      enum: ["super_admin", "admin"],
      default: "admin",
    },
    createdBy: {
      type: String,
      required: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

// Compare plain password against stored hash
AdminSchema.methods.comparePassword = async function (
  plain: string
): Promise<boolean> {
  return bcrypt.compare(plain, this.passwordHash);
};

// Index
AdminSchema.index({ username: 1 }, { unique: true });
AdminSchema.index({ role: 1 });

const Admin: Model<IAdmin> =
  mongoose.models.Admin || mongoose.model<IAdmin>("Admin", AdminSchema);

export default Admin;
