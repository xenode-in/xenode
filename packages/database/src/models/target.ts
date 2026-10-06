import { Schema, type Types } from "mongoose";
import { getModel } from "../model";

const envelopeSchema = new Schema(
  {
    // Envelope context (bound into the AAD and checked by crypto-core
    // `sameContext` on open). Persisted (not required at the schema level so
    // fixtures/legacy rows still save) — the /api/vault validator enforces
    // their presence for real writes so decrypt-time `sameContext` passes.
    accountId: { type: String },
    spaceId: { type: String },
    productId: { type: String },
    type: { type: String },
    formatVersion: { type: Number, required: true, min: 2 },
    algorithm: { type: String, enum: ["AES-256-GCM"], required: true },
    keyId: { type: String, required: true },
    keyVersion: { type: Number, required: true, min: 1 },
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    aadVersion: { type: Number, required: true, min: 1 },
    kdfParams: { type: Schema.Types.Mixed },
    createdAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "retired", "revoked"],
      required: true,
    },
  },
  { _id: false },
);

export interface UserVaultRecord {
  accountId: string;
  vaultRevision: number;
  /** Missing on Vaults that reused the login password; migrate in the browser. */
  passwordMode?: "separate";
  passwordEnvelope?: unknown | null;
  pendingPasswordEnvelope?: unknown | null;
  pendingPasswordMutationId?: string;
  pendingPasswordExpiresAt?: Date;
  recoveryEnvelope: unknown;
  deviceEnvelopes: unknown[];
  sharingPublicKey: string;
  wrappedSharingPrivateKey: unknown;
  formatVersion: 2;
  lastMutationId?: string;
  bootstrapOperationId?: string;
  bootstrapPayloadHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const userVaultSchema = new Schema<UserVaultRecord>(
  {
    accountId: { type: String, required: true, unique: true, index: true },
    vaultRevision: { type: Number, required: true, min: 1 },
    passwordMode: { type: String, enum: ["separate"], required: false },
    passwordEnvelope: { type: envelopeSchema, required: false, default: null },
    pendingPasswordEnvelope: {
      type: envelopeSchema,
      required: false,
      default: null,
    },
    pendingPasswordMutationId: String,
    pendingPasswordExpiresAt: Date,
    recoveryEnvelope: { type: envelopeSchema, required: true },
    deviceEnvelopes: { type: [envelopeSchema], default: [] },
    sharingPublicKey: { type: String, required: true },
    wrappedSharingPrivateKey: { type: envelopeSchema, required: true },
    formatVersion: { type: Number, enum: [2], required: true },
    lastMutationId: { type: String },
    bootstrapOperationId: { type: String, immutable: true },
    bootstrapPayloadHash: { type: String, immutable: true },
  },
  { timestamps: true, collection: "userVaults" },
);
userVaultSchema.index(
  { accountId: 1, lastMutationId: 1 },
  {
    unique: true,
    partialFilterExpression: { lastMutationId: { $type: "string" } },
  },
);
export const UserVault = getModel<UserVaultRecord>("UserVault", userVaultSchema);

export interface VaultPasskeyRecord {
  accountId: string;
  credentialId: string;
  publicKey: Buffer;
  counter: number;
  transports: string[];
  envelopeKeyId: string;
  prfInput: string;
  hkdfSalt: string;
  name?: string;
  status: "pending" | "active" | "revoked";
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const vaultPasskeySchema = new Schema<VaultPasskeyRecord>(
  {
    accountId: { type: String, required: true, index: true },
    credentialId: { type: String, required: true, unique: true, index: true },
    publicKey: { type: Buffer, required: true },
    counter: { type: Number, required: true, min: 0, default: 0 },
    transports: { type: [String], default: [] },
    envelopeKeyId: { type: String, required: true },
    prfInput: { type: String, required: true },
    hkdfSalt: { type: String, required: true },
    name: String,
    status: {
      type: String,
      enum: ["pending", "active", "revoked"],
      required: true,
      default: "active",
    },
    lastUsedAt: Date,
  },
  { timestamps: true, collection: "vaultPasskeys" },
);
vaultPasskeySchema.index({ accountId: 1, status: 1, createdAt: -1 });
export const VaultPasskey = getModel<VaultPasskeyRecord>(
  "VaultPasskey",
  vaultPasskeySchema,
);

export interface AccountPasskeyBindingRecord {
  accountId: string;
  passkeyId: string;
  credentialId: string;
  envelopeKeyId: string;
  prfInput: string;
  hkdfSalt: string;
  createdAt: Date;
  updatedAt: Date;
}

const accountPasskeyBindingSchema = new Schema<AccountPasskeyBindingRecord>(
  {
    accountId: { type: String, required: true, index: true },
    passkeyId: { type: String, required: true, unique: true, index: true },
    credentialId: { type: String, required: true, unique: true, index: true },
    envelopeKeyId: { type: String, required: true },
    prfInput: { type: String, required: true },
    hkdfSalt: { type: String, required: true },
  },
  { timestamps: true, collection: "accountPasskeyBindings" },
);
accountPasskeyBindingSchema.index({ accountId: 1, createdAt: -1 });
export const AccountPasskeyBinding = getModel<AccountPasskeyBindingRecord>(
  "AccountPasskeyBinding",
  accountPasskeyBindingSchema,
);

export interface TrustedSecondFactorRecord {
  accountId: string;
  tokenHash: string;
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const trustedSecondFactorSchema = new Schema<TrustedSecondFactorRecord>(
  {
    accountId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, required: true },
    revokedAt: Date,
  },
  { timestamps: true, collection: "trustedSecondFactors" },
);
trustedSecondFactorSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const TrustedSecondFactor = getModel<TrustedSecondFactorRecord>(
  "TrustedSecondFactor",
  trustedSecondFactorSchema,
);

export interface VaultPasskeyChallengeRecord {
  nonce: string;
  accountId: string;
  challenge: string;
  type: "registration" | "authentication";
  prfInput: string;
  hkdfSalt: string;
  credentialId?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const vaultPasskeyChallengeSchema =
  new Schema<VaultPasskeyChallengeRecord>(
    {
      nonce: { type: String, required: true, unique: true, index: true },
      accountId: { type: String, required: true, index: true },
      challenge: { type: String, required: true },
      type: {
        type: String,
        enum: ["registration", "authentication"],
        required: true,
      },
      prfInput: { type: String, required: true },
      hkdfSalt: { type: String, required: true },
      credentialId: String,
      expiresAt: { type: Date, required: true },
    },
    { timestamps: true, collection: "vaultPasskeyChallenges" },
  );
vaultPasskeyChallengeSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 },
);
export const VaultPasskeyChallenge =
  getModel<VaultPasskeyChallengeRecord>(
    "VaultPasskeyChallenge",
    vaultPasskeyChallengeSchema,
  );

export interface AccountProfileRecord {
  accountId: string;
  onboarded: boolean;
  defaultEncrypt: boolean;
  /** UI theme preference chosen at onboarding; products may read it. */
  theme?: "light" | "dark" | "system";
  /**
   * Storage region for this account's files, chosen once at onboarding and
   * IMMUTABLE thereafter — all of the account's objects live in this region's
   * bucket, so it cannot change without a data migration.
   */
  storageRegion?: "asia" | "us" | "eu";
  usernameHistory: Array<{ username: string; changedAt: Date }>;
  createdAt: Date;
  updatedAt: Date;
}
const accountProfileSchema = new Schema<AccountProfileRecord>(
  {
    accountId: { type: String, required: true, unique: true, index: true },
    onboarded: { type: Boolean, default: false },
    defaultEncrypt: { type: Boolean, default: true },
    theme: { type: String, enum: ["light", "dark", "system"] },
    storageRegion: { type: String, enum: ["asia", "us", "eu"] },
    usernameHistory: {
      type: [{ username: String, changedAt: Date }],
      default: [],
    },
  },
  { timestamps: true, collection: "accountProfiles" },
);
export const AccountProfile = getModel<AccountProfileRecord>(
  "AccountProfile",
  accountProfileSchema,
);

export interface BillingAccountRecord {
  accountId: string;
  spaceId?: string;
  plan: string;
  status: string;
  subscriptionId?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
const billingAccountSchema = new Schema<BillingAccountRecord>(
  {
    accountId: { type: String, required: true, unique: true, index: true },
    spaceId: { type: String, index: true },
    plan: { type: String, required: true, default: "free" },
    status: { type: String, required: true, default: "active", index: true },
    subscriptionId: { type: String, index: true },
    expiresAt: Date,
  },
  { timestamps: true, collection: "billingAccounts" },
);
export const BillingAccount = getModel<BillingAccountRecord>(
  "BillingAccount",
  billingAccountSchema,
);

export interface ProductSessionRecord {
  sessionId: string;
  accountId: string;
  productId: string;
  /** OIDC `sid` of the Accounts browser session that minted this session. */
  issuerSessionId: string;
  clientId: string;
  authenticatedAt: Date;
  sessionVersion: number;
  expiresAt: Date;
  revokedAt?: Date;
  /** Convenience workspace pointer for product UIs; NEVER an authorization source. */
  activeOrganizationId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
const productSessionSchema = new Schema<ProductSessionRecord>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    accountId: { type: String, required: true, index: true },
    productId: { type: String, required: true, index: true },
    issuerSessionId: { type: String, required: true, index: true },
    clientId: { type: String, required: true },
    authenticatedAt: { type: Date, required: true },
    sessionVersion: { type: Number, required: true, min: 1 },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: Date,
    activeOrganizationId: { type: String, default: null },
  },
  { timestamps: true, collection: "productSessions" },
);
productSessionSchema.index({ accountId: 1, productId: 1, revokedAt: 1 });
productSessionSchema.index({
  accountId: 1,
  issuerSessionId: 1,
  revokedAt: 1,
});
export const ProductSession = getModel<ProductSessionRecord>(
  "ProductSession",
  productSessionSchema,
);

interface BrowserLogoutCleanupTicketRecord {
  productId: string;
  tokenHash: string;
  consumedAt?: Date;
}

export interface BrowserLogoutTransactionRecord {
  transactionIdHash: string;
  accountId: string;
  issuerSessionId: string;
  initiatingProduct: string;
  cleanupTickets: BrowserLogoutCleanupTicketRecord[];
  expiresAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const browserLogoutCleanupTicketSchema =
  new Schema<BrowserLogoutCleanupTicketRecord>(
    {
      productId: { type: String, required: true },
      tokenHash: { type: String, required: true },
      consumedAt: Date,
    },
    { _id: false },
  );

const browserLogoutTransactionSchema =
  new Schema<BrowserLogoutTransactionRecord>(
    {
      transactionIdHash: {
        type: String,
        required: true,
        unique: true,
        index: true,
      },
      accountId: { type: String, required: true, index: true },
      issuerSessionId: { type: String, required: true, index: true },
      initiatingProduct: { type: String, required: true },
      cleanupTickets: {
        type: [browserLogoutCleanupTicketSchema],
        required: true,
      },
      expiresAt: { type: Date, required: true },
      completedAt: Date,
    },
    { timestamps: true, collection: "browserLogoutTransactions" },
  );
browserLogoutTransactionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 },
);

export const BrowserLogoutTransaction =
  getModel<BrowserLogoutTransactionRecord>(
    "BrowserLogoutTransaction",
    browserLogoutTransactionSchema,
  );

export interface KeyHandoffRecord {
  transactionId: string;
  accountId: string;
  clientId: string;
  productId: string;
  spaceId: string;
  destOrigin: string;
  ephemeralPublicKeyFingerprint: string;
  ciphertext: string;
  stateHash: string;
  nonceHash: string;
  expiresAt: Date;
  consumedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
const keyHandoffSchema = new Schema<KeyHandoffRecord>(
  {
    transactionId: { type: String, required: true, unique: true, index: true },
    accountId: { type: String, required: true, index: true },
    clientId: { type: String, required: true },
    productId: { type: String, required: true },
    spaceId: { type: String, required: true, index: true },
    destOrigin: { type: String, required: true },
    ephemeralPublicKeyFingerprint: { type: String, required: true },
    ciphertext: { type: String, required: true },
    stateHash: { type: String, required: true },
    nonceHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: Date,
  },
  { timestamps: true, collection: "keyHandoffs" },
);
keyHandoffSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const KeyHandoff = getModel<KeyHandoffRecord>(
  "KeyHandoff",
  keyHandoffSchema,
);

export interface AuditEventRecord {
  accountId: string;
  spaceId?: string;
  productId?: string;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}
const auditEventSchema = new Schema<AuditEventRecord>(
  {
    accountId: { type: String, required: true, index: true },
    spaceId: { type: String, index: true },
    productId: String,
    action: { type: String, required: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { collection: "auditEvents", versionKey: false },
);
auditEventSchema.index({ accountId: 1, createdAt: -1 });
auditEventSchema.index({ spaceId: 1, createdAt: -1 });
export const AuditEvent = getModel<AuditEventRecord>(
  "AuditEvent",
  auditEventSchema,
);

export interface PhotoUploadVariantRecord {
  key: string;
  size: number;
}

export interface PhotoUploadRecord {
  uploadId: string;
  assetId: string;
  accountId: string;
  spaceId: string;
  bucketId: Types.ObjectId;
  mediaType: "image" | "video";
  original: PhotoUploadVariantRecord;
  optimized?: PhotoUploadVariantRecord;
  thumbnail?: PhotoUploadVariantRecord;
  status: "pending" | "completing" | "completed" | "aborting" | "blocked";
  cleanupLeaseId?: string;
  cleanupLeaseExpiresAt?: Date;
  cleanupNextAttemptAt?: Date;
  cleanupError?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
const photoUploadVariantSchema = new Schema<PhotoUploadVariantRecord>(
  { key: { type: String, required: true }, size: { type: Number, required: true } },
  { _id: false },
);
const photoUploadSchema = new Schema<PhotoUploadRecord>(
  {
    uploadId: { type: String, required: true, unique: true, index: true },
    assetId: { type: String, required: true },
    accountId: { type: String, required: true },
    spaceId: { type: String, required: true },
    bucketId: { type: Schema.Types.ObjectId, required: true },
    mediaType: { type: String, enum: ["image", "video"], required: true },
    original: { type: photoUploadVariantSchema, required: true },
    optimized: photoUploadVariantSchema,
    thumbnail: photoUploadVariantSchema,
    status: {
      type: String,
      enum: ["pending", "completing", "completed", "aborting", "blocked"],
      required: true,
      default: "pending",
    },
    expiresAt: { type: Date, required: true },
    cleanupLeaseId: String,
    cleanupLeaseExpiresAt: Date,
    cleanupNextAttemptAt: Date,
    cleanupError: String,
  },
  { timestamps: true, collection: "photoUploads" },
);
photoUploadSchema.index({ spaceId: 1, assetId: 1 }, { unique: true });
// Expiry authorizes leased cleanup; never let a TTL discard unconfirmed blob ownership.
photoUploadSchema.index({ status: 1, expiresAt: 1, cleanupNextAttemptAt: 1 });
export const PhotoUpload = getModel<PhotoUploadRecord>("PhotoUpload", photoUploadSchema);

export interface PhotoAssetRecord {
  assetId: string;
  spaceId: string;
  storageObjectId: string;
  mediaType: "image" | "video";
  takenAt: Date;
  width?: number;
  height?: number;
  durationMs?: number;
  encryptedMetadata?: string;
  uploadSource: string;
  status: "active" | "trashed";
  trashedAt?: Date;
  purgeRequestedAt?: Date;
  createdByAccountId: string;
  syncContentFingerprint?: string;
  createdAt: Date;
  updatedAt: Date;
}
const photoAssetSchema = new Schema<PhotoAssetRecord>(
  {
    assetId: { type: String, required: true, unique: true, index: true },
    spaceId: { type: String, required: true, index: true },
    storageObjectId: { type: String, required: true, unique: true, index: true },
    mediaType: { type: String, enum: ["image", "video"], required: true },
    takenAt: { type: Date, required: true },
    width: Number,
    height: Number,
    durationMs: Number,
    encryptedMetadata: String,
    uploadSource: { type: String, required: true },
    status: { type: String, enum: ["active", "trashed"], default: "active" },
    trashedAt: Date,
    purgeRequestedAt: Date,
    createdByAccountId: { type: String, required: true },
    syncContentFingerprint: String,
  },
  { timestamps: true, collection: "photoAssets" },
);
photoAssetSchema.index({ spaceId: 1, takenAt: -1, assetId: -1 });
photoAssetSchema.index({ spaceId: 1, status: 1, trashedAt: -1, assetId: -1 });
// Retention cron: expired trash across all Spaces.
photoAssetSchema.index({ trashedAt: 1 }, { partialFilterExpression: { status: "trashed" } });
photoAssetSchema.index(
  { spaceId: 1, syncContentFingerprint: 1 },
  {
    unique: true,
    partialFilterExpression: { syncContentFingerprint: { $type: "string" } },
  },
);
export const PhotoAsset = getModel<PhotoAssetRecord>(
  "PhotoAsset",
  photoAssetSchema,
);

export interface PhotoAlbumRecord {
  albumId: string;
  spaceId: string;
  encryptedName: string;
  photoAssetIds: string[];
  coverPhotoAssetId?: string;
  sourceRef?: string;
  createdByAccountId: string;
  createdAt: Date;
  updatedAt: Date;
}
const photoAlbumSchema = new Schema<PhotoAlbumRecord>(
  {
    albumId: { type: String, required: true, unique: true, index: true },
    spaceId: { type: String, required: true, index: true },
    encryptedName: { type: String, required: true },
    photoAssetIds: { type: [String], default: [] },
    coverPhotoAssetId: String,
    sourceRef: String,
    createdByAccountId: { type: String, required: true },
  },
  { timestamps: true, collection: "photoAlbumsV2" },
);
photoAlbumSchema.index({ spaceId: 1, updatedAt: -1, albumId: -1 });
photoAlbumSchema.index(
  { spaceId: 1, sourceRef: 1 },
  {
    unique: true,
    partialFilterExpression: { sourceRef: { $type: "string" } },
  },
);
export const PhotoAlbumV2 = getModel<PhotoAlbumRecord>(
  "PhotoAlbumV2",
  photoAlbumSchema,
);
