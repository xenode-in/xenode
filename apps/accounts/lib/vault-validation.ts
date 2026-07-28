import type { CryptoEnvelope } from "@xenode/crypto-core";

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
