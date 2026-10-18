import { describe, expect, it } from "vitest";
import {
  browserDeviceKeyId,
  BROWSER_DEVICE_TRUST_MAX_AGE_MS,
  generateDeviceWrappingKey,
  isActiveBrowserDeviceEnvelope,
  isBrowserDeviceWrap,
  openEnvelopeWithKey,
  sealEnvelopeWithKey,
} from "../src";
const accountId = "device-policy-account",
  deviceId = "12345678-1234-1234-1234-123456789abc";
const now = new Date("2026-10-18T00:00:00.000Z");
async function fixture(duration = BROWSER_DEVICE_TRUST_MAX_AGE_MS) {
  const key = await generateDeviceWrappingKey(),
    ark = crypto.getRandomValues(new Uint8Array(32));
  const expiresAt = new Date(now.getTime() + duration).toISOString();
  const envelope = {
    ...(await sealEnvelopeWithKey(
      ark,
      key,
      {
        accountId,
        keyId: browserDeviceKeyId(deviceId, expiresAt),
        keyVersion: 1,
        type: "device",
      },
      now,
    )),
    kdfParams: {
      algorithm: "browser-device-aes-gcm" as const,
      deviceId,
      deviceName: "Test browser",
      createdAt: now.toISOString(),
      expiresAt,
    },
  };
  return { key, ark, envelope };
}
describe("bounded browser device trust", () => {
  it("accepts the live interval and rejects its exact deadline", async () => {
    const { envelope } = await fixture();
    expect(
      isActiveBrowserDeviceEnvelope(envelope, accountId, now.getTime()),
    ).toBe(true);
    expect(
      isActiveBrowserDeviceEnvelope(
        envelope,
        accountId,
        Date.parse(envelope.kdfParams.expiresAt) - 1,
      ),
    ).toBe(true);
    expect(
      isActiveBrowserDeviceEnvelope(
        envelope,
        accountId,
        Date.parse(envelope.kdfParams.expiresAt),
      ),
    ).toBe(false);
    expect(
      isActiveBrowserDeviceEnvelope(
        { ...envelope, createdAt: now },
        accountId,
        now.getTime(),
      ),
    ).toBe(true);
    expect(
      isActiveBrowserDeviceEnvelope(
        (await fixture(BROWSER_DEVICE_TRUST_MAX_AGE_MS + 1)).envelope,
        accountId,
        now.getTime(),
      ),
    ).toBe(false);
    expect(
      isActiveBrowserDeviceEnvelope(
        envelope,
        accountId,
        now.getTime() - 6 * 60_000,
      ),
    ).toBe(false);
  });
  it("uses the existing envelope AAD to authenticate the deadline", async () => {
    const { key, ark, envelope } = await fixture();
    expect(await openEnvelopeWithKey(envelope, key, envelope)).toEqual(ark);
    const expiresAt = new Date(now.getTime() + 29 * 86400_000).toISOString();
    const tampered = {
      ...envelope,
      keyId: browserDeviceKeyId(deviceId, expiresAt),
      kdfParams: { ...envelope.kdfParams, expiresAt },
    };
    expect(
      isActiveBrowserDeviceEnvelope(tampered, accountId, now.getTime()),
    ).toBe(true);
    await expect(
      openEnvelopeWithKey(tampered, key, tampered),
    ).rejects.toThrow();
    expect(
      isActiveBrowserDeviceEnvelope(
        { ...envelope, kdfParams: tampered.kdfParams },
        accountId,
        now.getTime(),
      ),
    ).toBe(false);
  });
  it("refuses foreign, malformed, revoked and unbounded browser envelopes", async () => {
    const { envelope } = await fixture();
    for (const invalid of [
      { ...envelope, accountId: "foreign" },
      { ...envelope, spaceId: "foreign-space" },
      { ...envelope, status: "revoked" },
      { ...envelope, ciphertext: "plaintext" },
      {
        ...envelope,
        keyId: `ark:device:${deviceId}`,
        kdfParams: { ...envelope.kdfParams, expiresAt: undefined },
      },
      {
        ...envelope,
        kdfParams: { ...envelope.kdfParams, createdAt: "yesterday" },
      },
    ])
      expect(
        isActiveBrowserDeviceEnvelope(invalid, accountId, now.getTime()),
      ).toBe(false);
  });
  it("identifies browser wraps separately from passkey/PRF wraps", async () => {
    const { envelope } = await fixture();
    expect(isBrowserDeviceWrap(envelope)).toBe(true);
    expect(isBrowserDeviceWrap({ keyId: `ark:device:${deviceId}` })).toBe(true);
    expect(
      isBrowserDeviceWrap({
        keyId: "ark:account-passkey:credential",
        type: "device",
        kdfParams: { algorithm: "webauthn-prf-hkdf-sha256" },
      }),
    ).toBe(false);
  });
});
