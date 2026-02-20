import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUserKeyVault extends Document {
  userId: string;
  /** Base64-encoded SubjectPublicKeyInfo (RSA-OAEP 4096-bit public key) */
  publicKey: string;
  /** Base64-encoded AES-256-GCM encrypted PKCS#8 private key */
  encryptedPrivateKey: string;
  /** Base64-encoded 16-byte PBKDF2 salt */
  pbkdf2Salt: string;
  /** Base64-encoded 12-byte GCM IV used to encrypt the private key */
  iv: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserKeyVaultSchema = new Schema<IUserKeyVault>(
  {
    userId: {
      type: String,
      required: [true, "User ID is required"],
      unique: true,
      index: true,
    },
    publicKey: {
      type: String,
      required: [true, "Public key is required"],
    },
    encryptedPrivateKey: {
      type: String,
      required: [true, "Encrypted private key is required"],
    },
    pbkdf2Salt: {
      type: String,
      required: [true, "PBKDF2 salt is required"],
    },
    iv: {
      type: String,
      required: [true, "IV is required"],
    },
  },
  {
    timestamps: true,
  },
);

const UserKeyVault: Model<IUserKeyVault> =
  mongoose.models.UserKeyVault ||
  mongoose.model<IUserKeyVault>("UserKeyVault", UserKeyVaultSchema);

export default UserKeyVault;
