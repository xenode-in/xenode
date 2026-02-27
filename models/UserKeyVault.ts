import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUserKeyVault extends Document {
  userId: string;
  /** RSA-OAEP 4096-bit public key (SPKI, base64) */
  publicKey: string;
  /** AES-GCM encrypted PKCS#8 private key (base64) */
  encryptedPrivateKey: string;
  /** PBKDF2 salt for the full vault passphrase (base64) */
  pbkdf2Salt: string;
  /** GCM IV for private key encryption (base64) */
  iv: string;
  /** Recovery words encrypted with master-password-only derived key (base64) */
  encryptedRecoveryWords: string;
  /** GCM IV for recovery words encryption (base64) */
  recoveryIv: string;
  /** PBKDF2 salt for master-password-only key derivation (base64) */
  recoverySalt: string;
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
    encryptedRecoveryWords: { type: String, required: true },
    recoveryIv: { type: String, required: true },
    recoverySalt: { type: String, required: true },
  },
  { timestamps: true },
);

const UserKeyVault: Model<IUserKeyVault> =
  mongoose.models.UserKeyVault ||
  mongoose.model<IUserKeyVault>("UserKeyVault", UserKeyVaultSchema);

export default UserKeyVault;
