import { decodeBase64Url, type CryptoEnvelope, type Argon2idParams } from "@xenode/crypto-core";
import { personalSpaceId } from "@xenode/spaces/ids";
import { isAccountEnvelope, isPasswordEnvelope, isVaultEnvelope } from "./vault-validation";

export interface VaultBootstrapPayload {
  passwordMode: "separate";
  passwordEnvelope: CryptoEnvelope & { kdfParams: Argon2idParams };
  recoveryEnvelope: CryptoEnvelope;
  deviceEnvelopes: CryptoEnvelope[];
  sharingPublicKey: string;
  wrappedSharingPrivateKey: CryptoEnvelope;
  productEnvelopes: { drive: CryptoEnvelope; photos: CryptoEnvelope };
}

function onlyFields(value: object, fields: readonly string[]) {
  return Object.keys(value).every((field) => fields.includes(field));
}

function sealed(value: unknown, ciphertextBytes?: number): value is CryptoEnvelope {
  if (!isVaultEnvelope(value) || value.status !== "active" || value.keyVersion !== 1 ||
    !onlyFields(value, ["accountId", "spaceId", "productId", "type", "formatVersion", "algorithm",
      "keyId", "keyVersion", "ciphertext", "iv", "aadVersion", "kdfParams", "createdAt", "status"])) return false;
  try {
    const bytes = decodeBase64Url(value.ciphertext).length;
    return /^[A-Za-z0-9_-]+$/u.test(value.ciphertext) && /^[A-Za-z0-9_-]+$/u.test(value.iv) &&
      decodeBase64Url(value.iv).length === 12 &&
      (ciphertextBytes === undefined ? bytes > 16 && bytes <= 8192 : bytes === ciphertextBytes);
  } catch { return false; }
}

export function isVaultBootstrapPayload(value: unknown, accountId: string): value is VaultBootstrapPayload {
  if (!value || typeof value !== "object" || !onlyFields(value, ["passwordMode", "passwordEnvelope",
    "recoveryEnvelope", "deviceEnvelopes", "sharingPublicKey", "wrappedSharingPrivateKey", "productEnvelopes"])) return false;
  const body = value as Partial<VaultBootstrapPayload>;
  if (body.passwordMode !== "separate" || !isPasswordEnvelope(body.passwordEnvelope, accountId) ||
    !sealed(body.passwordEnvelope, 48) ||
    !onlyFields(body.passwordEnvelope.kdfParams, ["algorithm", "memoryKiB", "iterations", "parallelism", "salt", "outputLength"]) ||
    !sealed(body.recoveryEnvelope, 48) || !isAccountEnvelope(body.recoveryEnvelope, accountId, "recovery") ||
    body.recoveryEnvelope.keyId !== "ark" || body.recoveryEnvelope.kdfParams !== undefined ||
    !sealed(body.wrappedSharingPrivateKey) || !isAccountEnvelope(body.wrappedSharingPrivateKey, accountId, "sharing-private-key") ||
    body.wrappedSharingPrivateKey.keyId !== "sharing-private-key" || body.wrappedSharingPrivateKey.kdfParams !== undefined ||
    !Array.isArray(body.deviceEnvelopes) || body.deviceEnvelopes.length > 1 ||
    !body.deviceEnvelopes.every((envelope) => {
      if (!sealed(envelope, 48) || !isAccountEnvelope(envelope, accountId, "device")) return false;
      const kdf = envelope.kdfParams as Record<string, unknown> | undefined;
      return !!kdf && onlyFields(kdf, ["algorithm", "deviceId", "deviceName", "createdAt"]) &&
        kdf.algorithm === "browser-device-aes-gcm" && typeof kdf.deviceId === "string" &&
        /^[a-f0-9-]{36}$/u.test(kdf.deviceId) && envelope.keyId === `ark:device:${kdf.deviceId}` &&
        typeof kdf.deviceName === "string" && kdf.deviceName.length <= 200 &&
        typeof kdf.createdAt === "string" && Number.isFinite(Date.parse(kdf.createdAt));
    }) || typeof body.sharingPublicKey !== "string" || body.sharingPublicKey.length < 100 ||
    body.sharingPublicKey.length > 2000 || !/^[A-Za-z0-9_-]+$/u.test(body.sharingPublicKey) ||
    !body.productEnvelopes || typeof body.productEnvelopes !== "object" ||
    !onlyFields(body.productEnvelopes, ["drive", "photos"])) return false;
  const spaceId = personalSpaceId(accountId);
  return (["drive", "photos"] as const).every((productId) => {
    const envelope = body.productEnvelopes![productId];
    return sealed(envelope, 48) && envelope.accountId === accountId && envelope.spaceId === spaceId &&
      envelope.productId === productId && envelope.type === "product-space-key" &&
      envelope.keyId === `${spaceId}:${productId}` && envelope.kdfParams === undefined;
  });
}
