import type { BrowserDeviceWrappingParams, CryptoEnvelope } from "./types";
import { decodeBase64Url, utf8 } from "./encoding";

export const PASSKEY_WRAP_INFO = "xenode/ark-passkey-wrap/v1" as const;

export async function generateDeviceWrappingKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function derivePasskeyWrappingKey(
  prfOutput: Uint8Array,
  hkdfSaltBase64Url: string,
): Promise<CryptoKey> {
  if (prfOutput.length !== 32) {
    throw new Error("WebAuthn PRF output must be 256 bits");
  }
  const material = await crypto.subtle.importKey(
    "raw",
    prfOutput as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: decodeBase64Url(hkdfSaltBase64Url) as BufferSource,
      info: utf8(PASSKEY_WRAP_INFO) as BufferSource,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export const BROWSER_DEVICE_TRUST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEVICE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEVICE_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
export type BrowserDeviceEnvelope = CryptoEnvelope & {
  kdfParams: BrowserDeviceWrappingParams;
};

function isoTime(value: unknown): number | null {
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value
    ? time
    : null;
}

/** Expiry is part of the existing envelope AAD through its key identity. */
export function browserDeviceKeyId(
  deviceId: string,
  expiresAt: string,
): string {
  const deadline = isoTime(expiresAt);
  if (!DEVICE_ID.test(deviceId) || deadline === null)
    throw new Error("Invalid browser device identity");
  return `ark:device:${deviceId}:${deadline}`;
}

/** Shared policy for bootstrap, enrollment, server reads and local restoration. */
export function isActiveBrowserDeviceEnvelope(
  value: unknown,
  accountId: string,
  now = Date.now(),
): value is BrowserDeviceEnvelope {
  if (!value || typeof value !== "object" || !Number.isFinite(now))
    return false;
  const envelope = value as Partial<CryptoEnvelope>;
  const params = envelope.kdfParams as
    Partial<BrowserDeviceWrappingParams> | undefined;
  if (
    !params ||
    typeof params !== "object" ||
    Array.isArray(params) ||
    Object.keys(params).some(
      (field) =>
        ![
          "algorithm",
          "deviceId",
          "deviceName",
          "createdAt",
          "expiresAt",
        ].includes(field),
    ) ||
    params.algorithm !== "browser-device-aes-gcm" ||
    typeof params.deviceId !== "string" ||
    !DEVICE_ID.test(params.deviceId) ||
    typeof params.deviceName !== "string" ||
    !params.deviceName ||
    params.deviceName.length > 200
  )
    return false;
  const created = isoTime(params.createdAt),
    expires = isoTime(params.expiresAt);
  if (
    created === null ||
    expires === null ||
    created > now + DEVICE_CLOCK_SKEW_MS ||
    expires <= now ||
    expires <= created ||
    expires - created > BROWSER_DEVICE_TRUST_MAX_AGE_MS ||
    isoTime(envelope.createdAt) !== created
  )
    return false;
  return (
    envelope.accountId === accountId &&
    envelope.spaceId === undefined &&
    envelope.productId === undefined &&
    envelope.formatVersion === 2 &&
    envelope.algorithm === "AES-256-GCM" &&
    envelope.aadVersion === 1 &&
    envelope.type === "device" &&
    envelope.status === "active" &&
    envelope.keyVersion === 1 &&
    envelope.keyId === browserDeviceKeyId(params.deviceId, params.expiresAt!) &&
    typeof envelope.ciphertext === "string" &&
    /^[A-Za-z0-9_-]{64}$/u.test(envelope.ciphertext) &&
    typeof envelope.iv === "string" &&
    /^[A-Za-z0-9_-]{16}$/u.test(envelope.iv)
  );
}

/** Browser persistence is separate from passkey/PRF device envelopes. */
export function isBrowserDeviceWrap(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<CryptoEnvelope>;
  return (
    (typeof envelope.keyId === "string" &&
      envelope.keyId.startsWith("ark:device:")) ||
    (envelope.kdfParams as Partial<BrowserDeviceWrappingParams> | undefined)
      ?.algorithm === "browser-device-aes-gcm"
  );
}
