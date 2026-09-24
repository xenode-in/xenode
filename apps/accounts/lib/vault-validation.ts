import {
  decodeBase64Url,
  validateArgon2idParams,
  type Argon2idParams,
  type CryptoEnvelope,
} from "@xenode/crypto-core";

export function isPasswordEnvelope(
  value: unknown,
  accountId: string,
): value is CryptoEnvelope & { kdfParams: Argon2idParams } {
  if (
    !isAccountEnvelope(value, accountId, "password") ||
    value.keyId !== "ark" ||
    value.keyVersion !== 1 ||
    value.status !== "active"
  )
    return false;
  try {
    validateArgon2idParams(value.kdfParams as Argon2idParams);
    return (
      decodeBase64Url(value.iv).length === 12 &&
      decodeBase64Url(value.ciphertext).length === 48
    );
  } catch {
    return false;
  }
}

export function isVaultEnvelope(value: unknown): value is CryptoEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<CryptoEnvelope>;
  return (
    typeof envelope.accountId === "string" &&
    envelope.accountId.length > 0 &&
    typeof envelope.type === "string" &&
    envelope.type.length > 0 &&
    (envelope.spaceId === undefined || typeof envelope.spaceId === "string") &&
    (envelope.productId === undefined ||
      typeof envelope.productId === "string") &&
    envelope.formatVersion === 2 &&
    envelope.algorithm === "AES-256-GCM" &&
    typeof envelope.keyId === "string" &&
    Number.isInteger(envelope.keyVersion) &&
    Number(envelope.keyVersion) > 0 &&
    typeof envelope.ciphertext === "string" &&
    envelope.ciphertext.length > 16 &&
    typeof envelope.iv === "string" &&
    envelope.iv.length >= 16 &&
    envelope.aadVersion === 1 &&
    typeof envelope.createdAt === "string" &&
    !Number.isNaN(new Date(envelope.createdAt).getTime()) &&
    (envelope.status === "active" ||
      envelope.status === "retired" ||
      envelope.status === "revoked")
  );
}

export function isAccountEnvelope(
  value: unknown,
  accountId: string,
  type: CryptoEnvelope["type"],
): value is CryptoEnvelope {
  return (
    isVaultEnvelope(value) &&
    value.accountId === accountId &&
    value.type === type &&
    !value.spaceId &&
    !value.productId
  );
}
