import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUserKeyVault extends Document {
  userId: string;
  publicKey: string;

  // ── Passphrase path (always present) ────────────────────────────────
  encryptedPrivKeyPassphrase: string; // privateKey encrypted with PBKDF2 master key
  passphraseIv: string;
  pbkdf2Salt: string;

  // ── PRF path (optional, added via Settings or onboarding) ─────────────
  encryptedPrivKeyPRF?: string;         // same privateKey, encrypted with PRF master key
  prfIv?: string;
  prfSalt?: string;
  credentialId?: string;

  // ── Vault state ────────────────────────────────────────────────────
  vaultType: "passphrase" | "prf" | "both";

  // ── Legacy fields (keep for backward compat with old PRF-only vaults) ──
  encryptedPrivateKey?: string;
  iv?: string;

  createdAt: Date;
  updatedAt: Date;
}

const UserKeyVaultSchema = new Schema<IUserKeyVault>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    publicKey: { type: String, required: true },

    // Passphrase path
    encryptedPrivKeyPassphrase: { type: String },
    passphraseIv: { type: String },
    pbkdf2Salt: { type: String, required: true },

    // PRF path
    encryptedPrivKeyPRF: { type: String },
    prfIv: { type: String },
    prfSalt: { type: String },
    credentialId: { type: String },

    // Vault state
    vaultType: {
      type: String,
      enum: ["passphrase", "prf", "both"],
      default: "passphrase",
    },

    // Legacy
    encryptedPrivateKey: { type: String },
    iv: { type: String },
  },
  { timestamps: true },
);

const UserKeyVault: Model<IUserKeyVault> =
  mongoose.models.UserKeyVault ||
  mongoose.model<IUserKeyVault>("UserKeyVault", UserKeyVaultSchema);

export default UserKeyVault;
