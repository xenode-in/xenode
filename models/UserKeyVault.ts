import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUserKeyVault extends Document {
  userId: string;
  publicKey: string;
  encryptedPrivateKey: string;
  pbkdf2Salt: string;
  iv: string;
  // PRF fields — only present for vaultType: 'prf'
  prfSalt?: string;
  credentialId?: string;
  vaultType: "prf" | "passphrase";
  createdAt: Date;
  updatedAt: Date;
}

const UserKeyVaultSchema = new Schema<IUserKeyVault>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    publicKey: { type: String, required: true },
    encryptedPrivateKey: { type: String, required: true },
    pbkdf2Salt: { type: String, required: true },
    iv: { type: String, required: true },
    // Optional PRF fields
    prfSalt: { type: String },
    credentialId: { type: String },
    vaultType: {
      type: String,
      enum: ["prf", "passphrase"],
      default: "passphrase",
    },
  },
  { timestamps: true },
);

const UserKeyVault: Model<IUserKeyVault> =
  mongoose.models.UserKeyVault ||
  mongoose.model<IUserKeyVault>("UserKeyVault", UserKeyVaultSchema);

export default UserKeyVault;
