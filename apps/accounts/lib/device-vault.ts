"use client";

import {
  generateDeviceWrappingKey,
  browserDeviceKeyId,
  isActiveBrowserDeviceEnvelope,
  BROWSER_DEVICE_TRUST_MAX_AGE_MS,
  importProductKey,
  openEnvelopeWithKey,
  sealEnvelopeWithKey,
  type BrowserDeviceWrappingParams,
  type CryptoEnvelope,
} from "@xenode/crypto-core";
import {
  deletePersistedKey,
  loadPersistedKey,
  savePersistedKey,
} from "@xenode/crypto-react";

const DEVICE_KEY_STORE = "accounts-device-wrap";
const DEVICE_ID_PREFIX = "xenode-vault-device:";

export type DeviceEnvelope = CryptoEnvelope & {
  kdfParams: BrowserDeviceWrappingParams;
};

function storageKey(accountId: string) {
  return `${DEVICE_ID_PREFIX}${accountId}`;
}

function deviceName(): string {
  if (typeof navigator === "undefined") return "Browser";
  return navigator.platform ? `${navigator.platform} browser` : "Browser";
}

function rememberedDevice(accountId: string): string | null {
  try {
    return localStorage.getItem(storageKey(accountId));
  } catch {
    return null;
  }
}

export async function createBrowserDeviceEnvelope(
  accountId: string,
  ark: Uint8Array,
): Promise<DeviceEnvelope> {
  if (ark.byteLength !== 32)
    throw new Error("Account root keys must be 256 bits");
  const deviceId = crypto.randomUUID();
  const wrappingKey = await generateDeviceWrappingKey();
  const created = new Date();
  const createdAt = created.toISOString();
  const expiresAt = new Date(
    created.getTime() + BROWSER_DEVICE_TRUST_MAX_AGE_MS,
  ).toISOString();
  const envelope = {
    ...(await sealEnvelopeWithKey(
      ark,
      wrappingKey,
      {
        accountId,
        keyId: browserDeviceKeyId(deviceId, expiresAt),
        keyVersion: 1,
        type: "device",
      },
      created,
    )),
    kdfParams: {
      algorithm: "browser-device-aes-gcm",
      deviceId,
      deviceName: deviceName(),
      createdAt,
      expiresAt,
    },
  } satisfies DeviceEnvelope;
  await savePersistedKey(DEVICE_KEY_STORE, deviceId, wrappingKey);
  try {
    localStorage.setItem(storageKey(accountId), deviceId);
  } catch {
    await deletePersistedKey(DEVICE_KEY_STORE, deviceId);
    throw new Error("This browser cannot persist a trusted-device key.");
  }
  return envelope;
}

export async function loadBrowserDeviceArk(
  accountId: string,
  envelopes: readonly CryptoEnvelope[],
): Promise<CryptoKey | null> {
  const deviceId = rememberedDevice(accountId);
  if (!deviceId) return null;
  const envelope = envelopes.find(
    (candidate) =>
      isActiveBrowserDeviceEnvelope(candidate, accountId) &&
      candidate.kdfParams.deviceId === deviceId,
  );
  if (!envelope) {
    await discardBrowserDevice(accountId, deviceId);
    return null;
  }
  const wrappingKey = await loadPersistedKey(DEVICE_KEY_STORE, deviceId);
  if (!wrappingKey) {
    await discardBrowserDevice(accountId, deviceId);
    return null;
  }
  if (!isActiveBrowserDeviceEnvelope(envelope, accountId)) {
    await discardBrowserDevice(accountId, deviceId);
    return null;
  }
  let ark: Uint8Array | undefined;
  try {
    ark = await openEnvelopeWithKey(envelope, wrappingKey, {
      accountId,
      keyId: envelope.keyId,
      keyVersion: envelope.keyVersion,
      type: "device",
    });
    const key = await importProductKey(ark);
    if (!isActiveBrowserDeviceEnvelope(envelope, accountId)) {
      await discardBrowserDevice(accountId, deviceId);
      return null;
    }
    return key;
  } catch {
    await discardBrowserDevice(accountId, deviceId);
    return null;
  } finally {
    ark?.fill(0);
  }
}

async function discardBrowserDevice(
  accountId: string,
  deviceId: string,
): Promise<void> {
  try {
    if (rememberedDevice(accountId) === deviceId)
      localStorage.removeItem(storageKey(accountId));
  } catch {
    /* Storage may be unavailable. */
  }
  await deletePersistedKey(DEVICE_KEY_STORE, deviceId).catch(() => undefined);
}

export async function forgetBrowserDevice(accountId: string): Promise<void> {
  const deviceId = rememberedDevice(accountId);
  if (deviceId) await discardBrowserDevice(accountId, deviceId);
}

export async function enrollBrowserDevice(
  accountId: string,
  ark: Uint8Array,
  expectedVaultRevision: number,
): Promise<number> {
  const previous = rememberedDevice(accountId);
  const envelope = await createBrowserDeviceEnvelope(accountId, ark);
  try {
    const response = await fetch("/api/vault/devices", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID().replaceAll("-", ""),
      },
      body: JSON.stringify({ expectedVaultRevision, envelope }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      vaultRevision?: number;
    };
    if (
      !response.ok ||
      !Number.isSafeInteger(payload.vaultRevision) ||
      payload.vaultRevision! < 1
    )
      throw new Error(payload.error ?? "Could not trust this browser.");
    return payload.vaultRevision!;
  } catch (error) {
    await discardBrowserDevice(accountId, envelope.kdfParams.deviceId);
    // A failed new enrollment must not discard an earlier consented key.
    try {
      if (previous && !rememberedDevice(accountId))
        localStorage.setItem(storageKey(accountId), previous);
    } catch {
      /* Password unlock remains available. */
    }
    throw error;
  }
}
