import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUser extends Document {
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string;
  createdAt: Date;
  updatedAt: Date;
  onboarded: boolean;
  encryptByDefault: boolean;
  
  // Extra fields for zero-knowledge recovery & session invalidation
  authVerifier?: string;
  authSalt?: string;
  passwordChangedAt?: Date;
  credentialEpoch?: Date;

  // 2FA Fields
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
  twoFactorBackupCodes?: string;
  subscriptionStatus?: "none" | "active" | "past_due" | "halted" | "cancelled";
  subscriptionId?: mongoose.Types.ObjectId | string | null;
  subscriptionExpiresAt?: Date | null;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    emailVerified: { type: Boolean, default: false },
    image: { type: String },
    onboarded: { type: Boolean, default: false },
    encryptByDefault: { type: Boolean, default: false },
    
    authVerifier: { type: String },
    authSalt: { type: String },
    passwordChangedAt: { type: Date },
    credentialEpoch: { type: Date },

    // 2FA Fields
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String },
    twoFactorBackupCodes: { type: String },
    subscriptionStatus: {
      type: String,
      enum: ["none", "active", "past_due", "halted", "cancelled"],
      default: "none",
      index: true,
    },
    subscriptionId: { type: Schema.Types.Mixed, default: null },
    subscriptionExpiresAt: { type: Date, default: null, index: true },
  },
  { 
    timestamps: true,
    // ensure we point to the same collection better-auth uses
    collection: "user" 
  }
);

const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);

export { User };
