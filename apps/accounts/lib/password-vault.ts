"use client";

import { VAULT_CLIENT_HEADERS } from "@/lib/vault-protocol";

import {
  deriveRecoveryKeyFromMnemonic,
  derivePasswordWrappingKey,
  encodeBase64Url,
  openEnvelope,
  sealEnvelope,
  type Argon2idParams,
  type CryptoEnvelope,
} from "@xenode/crypto-core";
import { deriveArgon2id } from "@/lib/argon2";
import { cacheAccountRootKey } from "@/lib/ark-cache";
import { enrollBrowserDevice, loadBrowserDeviceArk } from "@/lib/device-vault";

export type VaultResponse = {
  accountId: string;
  vault: {
    vaultRevision: number;
    passwordMode?: "separate";
    passwordEnvelope?: (CryptoEnvelope & { kdfParams: Argon2idParams }) | null;
    pendingPasswordEnvelope?:
      | (CryptoEnvelope & { kdfParams: Argon2idParams })
      | null;
    recoveryEnvelope: CryptoEnvelope;
    wrappedSharingPrivateKey: CryptoEnvelope;
    deviceEnvelopes: CryptoEnvelope[];
  } | null;
};

async function loadVault(): Promise<VaultResponse> {
  const response = await fetch("/api/vault", {
    headers: VAULT_CLIENT_HEADERS,
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not load the encrypted Vault.");
  return response.json();
}

export function randomPasswordParams(): Argon2idParams {
  return {
    algorithm: "argon2id",
    memoryKiB: 64 * 1024,
    iterations: 3,
    parallelism: 1,
    salt: encodeBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    outputLength: 32,
  };
}

export async function createPasswordEnvelopeForArk(
  accountId: string,
  ark: Uint8Array,
  password: string,
) {
  if (password.length < 12 || password.length > 128)
    throw new Error("Use a Vault password between 12 and 128 characters.");
  const kdfParams = randomPasswordParams();
  const key = await derivePasswordWrappingKey(
    password,
    kdfParams,
    deriveArgon2id,
  );
  try {
    return {
      ...(await sealEnvelope(ark, key, {
        accountId,
        keyId: "ark",
        keyVersion: 1,
        type: "password",
      })),
      kdfParams,
    };
  } finally {
    key.fill(0);
  }
}

async function openPasswordEnvelope(
  data: VaultResponse,
  password: string,
): Promise<Uint8Array> {
  if (!data.vault) throw new Error("The encrypted Vault is not set up.");
  // Retain local recovery of old interrupted credential rotations even after
  // their former TTL. Never finalize a login credential from this read path.
  const candidates = [
    ...(data.vault.passwordMode !== "separate" &&
    data.vault.pendingPasswordEnvelope
      ? [data.vault.pendingPasswordEnvelope]
      : []),
    ...(data.vault.passwordEnvelope ? [data.vault.passwordEnvelope] : []),
  ];
  for (const envelope of candidates) {
    const key = await derivePasswordWrappingKey(
      password,
      envelope.kdfParams,
      deriveArgon2id,
    );
    try {
      return await openEnvelope(envelope, key, {
        accountId: data.accountId,
        keyId: "ark",
        keyVersion: 1,
        type: "password",
      });
    } catch {
      // Another active/legacy wrap may match. No password leaves this tab.
    } finally {
      key.fill(0);
    }
  }
  throw new Error("That Vault password could not unlock this Vault.");
}

/** Local Vault password only. Authentication credentials are a separate flow. */
export async function openArkWithPassword(password: string) {
  const data = await loadVault();
  const ark = await openPasswordEnvelope(data, password);
  return {
    accountId: data.accountId,
    ark,
    vaultRevision: data.vault!.vaultRevision,
  };
}

export async function unlockVaultWithPassword(
  password: string,
  options: { trustDevice?: boolean } = {},
): Promise<void> {
  const data = await loadVault();
  if (data.vault?.passwordMode !== "separate")
    throw new Error("Choose a separate Vault password first.");
  const ark = await openPasswordEnvelope(data, password);
  try {
    await cacheAccountRootKey(data.accountId, ark);
    if (
      options.trustDevice === true &&
      !(await loadBrowserDeviceArk(data.accountId, data.vault.deviceEnvelopes))
    ) {
      await enrollBrowserDevice(
        data.accountId,
        ark,
        data.vault.vaultRevision,
      ).catch(() => undefined);
    }
  } finally {
    ark.fill(0);
  }
}

/** A navigation hint after local unlock, not server verification of a secret. */
export async function confirmVaultUnlock(
  method: "password" | "trusted-device" | "recovery",
): Promise<void> {
  const response = await fetch("/api/vault/unlock", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method }),
  });
  if (!response.ok)
    throw new Error("Could not continue after local Vault unlock.");
}

/** Rewrap the existing ARK; never regenerate product, file or recovery keys. */
export async function updateVaultPassword(input: {
  currentPassword?: string;
  recoveryPhrase?: string;
  newPassword: string;
}): Promise<void> {
  if (input.currentPassword && input.currentPassword === input.newPassword) {
    throw new Error(
      "Choose a different Vault password. Do not reuse your sign-in password.",
    );
  }
  const data = await loadVault();
  if (!data.vault) throw new Error("The encrypted Vault is not set up.");
  let ark: Uint8Array | undefined;
  try {
    if (input.recoveryPhrase?.trim()) {
      const key = await deriveRecoveryKeyFromMnemonic(input.recoveryPhrase);
      try {
        ark = await openEnvelope(data.vault.recoveryEnvelope, key, {
          accountId: data.accountId,
          keyId: "ark",
          keyVersion: 1,
          type: "recovery",
        });
      } finally {
        key.fill(0);
      }
    } else {
      ark = await openPasswordEnvelope(data, input.currentPassword ?? "");
    }
    // A legacy pending wrap must still open the existing key hierarchy. Never
    // replace the only working password wrap with an unrelated recovered ARK.
    const sharingKey = await openEnvelope(
      data.vault.wrappedSharingPrivateKey,
      ark,
      {
        accountId: data.accountId,
        keyId: "sharing-private-key",
        keyVersion: 1,
        type: "sharing-private-key",
      },
    );
    sharingKey.fill(0);
    const passwordEnvelope = await createPasswordEnvelopeForArk(
      data.accountId,
      ark,
      input.newPassword,
    );
    const request: RequestInit = {
      method: "PUT",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID().replaceAll("-", ""),
      },
      body: JSON.stringify({
        expectedVaultRevision: data.vault.vaultRevision,
        passwordEnvelope,
      }),
    };
    const send = () => fetch("/api/vault/separate-password", request);
    const response = await send().catch(send);
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok)
      throw new Error(
        payload.error ?? "Could not save the encrypted Vault envelope.",
      );
    await cacheAccountRootKey(data.accountId, ark);
  } finally {
    ark?.fill(0);
  }
}
