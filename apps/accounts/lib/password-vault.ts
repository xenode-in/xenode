"use client";

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
import {
  enrollBrowserDevice,
  loadBrowserDeviceArk,
} from "@/lib/device-vault";

type VaultResponse = {
  accountId: string;
  vault: {
    vaultRevision: number;
    passwordEnvelope?:
      | (CryptoEnvelope & { kdfParams: Argon2idParams })
      | null;
    recoveryEnvelope: CryptoEnvelope;
    deviceEnvelopes: CryptoEnvelope[];
  } | null;
};

function randomPasswordParams(): Argon2idParams {
  return {
    algorithm: "argon2id",
    memoryKiB: 64 * 1024,
    iterations: 3,
    parallelism: 1,
    salt: encodeBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    outputLength: 32,
  };
}

/**
 * Verify a Vault password locally and cache the unlocked ARK for handoffs.
 * The password is used only by Argon2id in this browser and is never sent by
 * this function.
 */
export async function cacheArkFromLogin(
  password: string,
  options: { trustDevice?: boolean } = {},
): Promise<void> {
  const response = await fetch("/api/vault", {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not load the encrypted Vault.");
  const data = (await response.json()) as VaultResponse;
  if (!data.vault) throw new Error("The encrypted Vault is not set up.");
  const envelope = data.vault.passwordEnvelope;
  if (!envelope) {
    throw new Error(
      "This Vault does not have a password envelope. Use recovery to add one.",
    );
  }

  const passwordKey = await derivePasswordWrappingKey(
    password,
    envelope.kdfParams,
    deriveArgon2id,
  );
  let ark: Uint8Array | undefined;
  try {
    ark = await openEnvelope(envelope, passwordKey, {
      accountId: data.accountId,
      keyId: "ark",
      keyVersion: 1,
      type: "password",
    });
    await cacheAccountRootKey(data.accountId, ark);
    if (options.trustDevice !== false) {
      const enrolled = await loadBrowserDeviceArk(
        data.accountId,
        data.vault.deviceEnvelopes,
      );
      if (!enrolled) {
        await enrollBrowserDevice(
          data.accountId,
          ark,
          data.vault.vaultRevision,
        ).catch(() => undefined);
      }
    }
  } finally {
    ark?.fill(0);
    passwordKey.fill(0);
  }
}

export async function confirmVaultUnlock(
  method: "password" | "trusted-device",
  password?: string,
): Promise<void> {
  const response = await fetch("/api/vault/unlock", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, ...(password ? { password } : {}) }),
  });
  if (!response.ok) {
    throw new Error("Could not confirm the Vault unlock.");
  }
}

/**
 * Upgrade a legacy passwordless Vault without rotating its ARK or product keys.
 * Recovery opens the existing ARK locally; only a new encrypted password
 * envelope is sent to Accounts.
 */
export async function addPasswordToVault(
  password: string,
  recoveryPhrase: string,
): Promise<void> {
  const response = await fetch("/api/vault", {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not load the encrypted Vault.");
  const data = (await response.json()) as VaultResponse;
  if (!data.vault) throw new Error("The encrypted Vault is not set up.");
  if (data.vault.passwordEnvelope) {
    await cacheArkFromLogin(password);
    return;
  }

  const recoveryKey = await deriveRecoveryKeyFromMnemonic(recoveryPhrase);
  let ark: Uint8Array | undefined;
  let passwordKey: Uint8Array | undefined;
  try {
    ark = await openEnvelope(data.vault.recoveryEnvelope, recoveryKey, {
      accountId: data.accountId,
      keyId: "ark",
      keyVersion: 1,
      type: "recovery",
    });
    const kdfParams = randomPasswordParams();
    passwordKey = await derivePasswordWrappingKey(
      password,
      kdfParams,
      deriveArgon2id,
    );
    const passwordEnvelope = {
      ...(await sealEnvelope(ark, passwordKey, {
        accountId: data.accountId,
        keyId: "ark",
        keyVersion: 1,
        type: "password",
      })),
      kdfParams,
    };
    const update = await fetch("/api/vault/password-envelope", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID().replaceAll("-", ""),
      },
      body: JSON.stringify({
        expectedVaultRevision: data.vault.vaultRevision,
        passwordEnvelope,
      }),
    });
    if (!update.ok) {
      const payload = (await update.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(payload.error ?? "Could not add a Vault password.");
    }
    await cacheAccountRootKey(data.accountId, ark);
    const enrolled = await loadBrowserDeviceArk(
      data.accountId,
      data.vault.deviceEnvelopes,
    );
    if (!enrolled) {
      const payload = (await update.json().catch(() => ({}))) as {
        vaultRevision?: number;
      };
      if (payload.vaultRevision) {
        await enrollBrowserDevice(
          data.accountId,
          ark,
          payload.vaultRevision,
        ).catch(() => undefined);
      }
    }
  } finally {
    ark?.fill(0);
    passwordKey?.fill(0);
    recoveryKey.fill(0);
  }
}
