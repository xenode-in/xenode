export const ENVELOPE_FORMAT_VERSION = 2 as const;
export const ENVELOPE_ALGORITHM = "AES-256-GCM" as const;

export type EnvelopeType =
  | "password"
  | "recovery"
  | "device"
  | "sharing-private-key"
  | "product-space-key"
  | "file-dek"
  | "metadata-key";

export interface EnvelopeContext {
  accountId: string;
  spaceId?: string;
  productId?: string;
  keyId: string;
  keyVersion: number;
  type: EnvelopeType;
}

export interface CryptoEnvelope extends EnvelopeContext {
  formatVersion: typeof ENVELOPE_FORMAT_VERSION;
  algorithm: typeof ENVELOPE_ALGORITHM;
  ciphertext: string;
  iv: string;
  aadVersion: 1;
  /** KDF parameters for password/recovery envelopes (e.g. Argon2id); persisted alongside the envelope. */
  kdfParams?:
    | Argon2idParams
    | BrowserDeviceWrappingParams
    | WebAuthnPrfWrappingParams
    | Record<string, unknown>;
  createdAt: string;
  status: "active" | "retired" | "revoked";
}

export interface Argon2idParams {
  algorithm: "argon2id";
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  salt: string;
  outputLength: 32;
}

export interface BrowserDeviceWrappingParams {
  algorithm: "browser-device-aes-gcm";
  deviceId: string;
  deviceName: string;
  createdAt: string;
}

export interface WebAuthnPrfWrappingParams {
  algorithm: "webauthn-prf-hkdf-sha256";
  credentialIdHash: string;
  prfInput: string;
  hkdfSalt: string;
  info: "xenode/ark-passkey-wrap/v1";
}

export type Argon2idDeriver = (
  password: Uint8Array,
  params: Argon2idParams,
) => Promise<Uint8Array>;
