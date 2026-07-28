"use client";

import {
  generateDeviceWrappingKey,
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
  const deviceId = crypto.randomUUID();
  const wrappingKey = await generateDeviceWrappingKey();
  const createdAt = new Date().toISOString();
  const envelope = {
    ...(await sealEnvelopeWithKey(ark, wrappingKey, {
      accountId,
      keyId: `ark:device:${deviceId}`,
      keyVersion: 1,
      type: "device",
    })),
    kdfParams: {
      algorithm: "browser-device-aes-gcm",
      deviceId,
      deviceName: deviceName(),
      createdAt,
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
      candidate.type === "device" &&
      candidate.status === "active" &&
      candidate.keyId === `ark:device:${deviceId}`,
  );
  if (!envelope) return null;
  const wrappingKey = await loadPersistedKey(DEVICE_KEY_STORE, deviceId);
  if (!wrappingKey) return null;
  let ark: Uint8Array | undefined;
  try {
    ark = await openEnvelopeWithKey(envelope, wrappingKey, {
      accountId,
      keyId: envelope.keyId,
      keyVersion: envelope.keyVersion,
      type: "device",
    });
    return await importProductKey(ark);
  } catch {
    return null;
  } finally {
    ark?.fill(0);
  }
}

export async function forgetBrowserDevice(accountId: string): Promise<void> {
  const deviceId = rememberedDevice(accountId);
  try {
    localStorage.removeItem(storageKey(accountId));
  } catch {
    // Removing the IndexedDB key still disables this device.
  }
  if (deviceId) await deletePersistedKey(DEVICE_KEY_STORE, deviceId);
}

export async function enrollBrowserDevice(
  accountId: string,
  ark: Uint8Array,
  expectedVaultRevision: number,
): Promise<number> {
  const envelope = await createBrowserDeviceEnvelope(accountId, ark);
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
  if (!response.ok || !payload.vaultRevision) {
    await forgetBrowserDevice(accountId);
    throw new Error(payload.error ?? "Could not trust this browser.");
  }
  return payload.vaultRevision;
}
