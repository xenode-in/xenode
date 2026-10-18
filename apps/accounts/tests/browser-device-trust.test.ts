import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_DEVICE_TRUST_MAX_AGE_MS,
  browserDeviceKeyId,
  generateDeviceWrappingKey,
  isActiveBrowserDeviceEnvelope,
  openEnvelope,
  sealEnvelopeWithKey,
} from "@xenode/crypto-core";
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  load: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@xenode/crypto-react", () => ({
  savePersistedKey: mocks.save,
  loadPersistedKey: mocks.load,
  deletePersistedKey: mocks.remove,
}));
import {
  createBrowserDeviceEnvelope,
  enrollBrowserDevice,
  loadBrowserDeviceArk,
} from "../lib/device-vault";
const accountId = "browser-device-account",
  pointer = `xenode-vault-device:${accountId}`;
const storage = new Map<string, string>(),
  keys = new Map<string, CryptoKey>();
const now = new Date("2026-10-18T00:00:00.000Z");
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  storage.clear();
  keys.clear();
  vi.stubGlobal("localStorage", {
    getItem: (id: string) => storage.get(id) ?? null,
    setItem: (id: string, value: string) => storage.set(id, value),
    removeItem: (id: string) => storage.delete(id),
  });
  mocks.save.mockImplementation(async (_store, id, key) => keys.set(id, key));
  mocks.load.mockImplementation(async (_store, id) => keys.get(id) ?? null);
  mocks.remove.mockImplementation(async (_store, id) => {
    keys.delete(id);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const create = () =>
  createBrowserDeviceEnvelope(
    accountId,
    crypto.getRandomValues(new Uint8Array(32)),
  );
describe("Accounts browser wrapping-key lifetime", () => {
  it("creates a non-extractable consented key and restores the same root", async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32)),
      envelope = await createBrowserDeviceEnvelope(accountId, raw);
    expect(Date.parse(envelope.kdfParams.expiresAt) - now.getTime()).toBe(
      BROWSER_DEVICE_TRUST_MAX_AGE_MS,
    );
    expect(keys.get(envelope.kdfParams.deviceId)?.extractable).toBe(false);
    const root = await loadBrowserDeviceArk(accountId, [envelope]);
    expect(root).not.toBeNull();
    await expect(crypto.subtle.exportKey("raw", root!)).rejects.toThrow();
    const context = {
      accountId,
      keyId: "probe",
      keyVersion: 1,
      type: "metadata-key" as const,
    };
    const sealed = await sealEnvelopeWithKey(
      new Uint8Array([1, 2, 3]),
      root!,
      context,
    );
    expect(await openEnvelope(sealed, raw, context)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
  it.each(["expired", "revoked", "foreign", "missing"])(
    "forgets %s trust before reading a persisted key",
    async (condition) => {
      const envelope = await create();
      if (condition === "expired")
        vi.setSystemTime(new Date(envelope.kdfParams.expiresAt));
      const candidate =
        condition === "revoked"
          ? { ...envelope, status: "revoked" as const }
          : condition === "foreign"
            ? { ...envelope, accountId: "someone-else" }
            : envelope;
      expect(
        await loadBrowserDeviceArk(
          accountId,
          condition === "missing" ? [] : [candidate],
        ),
      ).toBeNull();
      expect(mocks.load).not.toHaveBeenCalled();
      expect(storage.has(pointer)).toBe(false);
      expect(keys.size).toBe(0);
    },
  );
  it("rejects an altered deadline even when its new header is plausible", async () => {
    const envelope = await create(),
      expiresAt = new Date(now.getTime() + 29 * 86400_000).toISOString();
    const tampered = {
      ...envelope,
      keyId: browserDeviceKeyId(envelope.kdfParams.deviceId, expiresAt),
      kdfParams: { ...envelope.kdfParams, expiresAt },
    };
    expect(isActiveBrowserDeviceEnvelope(tampered, accountId)).toBe(true);
    expect(await loadBrowserDeviceArk(accountId, [tampered])).toBeNull();
    expect(keys.size).toBe(0);
  });
  it("does not publish a root if trust expires during local key loading", async () => {
    const envelope = await create();
    mocks.load.mockImplementationOnce(async (_store, id) => {
      vi.setSystemTime(new Date(envelope.kdfParams.expiresAt));
      return keys.get(id);
    });
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    expect(await loadBrowserDeviceArk(accountId, [envelope])).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
  });
  it("cleans only the old key if another tab changes the remembered device", async () => {
    const envelope = await create(),
      otherId = crypto.randomUUID(),
      otherKey = await generateDeviceWrappingKey();
    mocks.load.mockImplementationOnce(async (_store, id) => {
      storage.set(pointer, otherId);
      keys.set(otherId, otherKey);
      vi.setSystemTime(new Date(envelope.kdfParams.expiresAt));
      return keys.get(id);
    });
    expect(await loadBrowserDeviceArk(accountId, [envelope])).toBeNull();
    expect(storage.get(pointer)).toBe(otherId);
    expect(keys.get(otherId)).toBe(otherKey);
  });
  it("cleans a failed enrollment without discarding earlier trust", async () => {
    const previous = await create();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network unavailable")),
    );
    await expect(
      enrollBrowserDevice(
        accountId,
        crypto.getRandomValues(new Uint8Array(32)),
        1,
      ),
    ).rejects.toThrow("network unavailable");
    expect(storage.get(pointer)).toBe(previous.kdfParams.deviceId);
    expect(keys.size).toBe(1);
    expect(await loadBrowserDeviceArk(accountId, [previous])).not.toBeNull();
  });
});
