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
    pendingPasswordEnvelope?:
      | (CryptoEnvelope & { kdfParams: Argon2idParams })
      | null;
    pendingPasswordMutationId?: string;
    pendingPasswordExpiresAt?: string | Date;
    recoveryEnvelope: CryptoEnvelope;
    deviceEnvelopes: CryptoEnvelope[];
  } | null;
};

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
  const kdfParams = randomPasswordParams();
  const passwordKey = await derivePasswordWrappingKey(
    password,
    kdfParams,
    deriveArgon2id,
  );
  try {
    return {
      ...(await sealEnvelope(ark, passwordKey, {
        accountId,
        keyId: "ark",
        keyVersion: 1,
        type: "password",
      })),
      kdfParams,
    };
  } finally {
    passwordKey.fill(0);
  }
}

export async function openArkWithPassword(password: string): Promise<{
  accountId: string;
  ark: Uint8Array;
  vaultRevision: number;
}> {
  const response = await fetch("/api/vault", {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not load the encrypted Vault.");
  const data = (await response.json()) as VaultResponse;
  if (!data.vault || !data.vault.passwordEnvelope) {
    throw new Error("This Vault does not have a password envelope.");
  }
  const pendingIsCurrent =
    data.vault.pendingPasswordEnvelope &&
    data.vault.pendingPasswordMutationId &&
    data.vault.pendingPasswordExpiresAt &&
    new Date(data.vault.pendingPasswordExpiresAt).getTime() > Date.now();
  const candidates = [
    ...(pendingIsCurrent && data.vault.pendingPasswordEnvelope
      ? [{
          envelope: data.vault.pendingPasswordEnvelope,
          mutationId: data.vault.pendingPasswordMutationId,
        }]
      : []),
    { envelope: data.vault.passwordEnvelope, mutationId: undefined },
  ];
  for (const candidate of candidates) {
    const passwordKey = await derivePasswordWrappingKey(
      password,
      candidate.envelope.kdfParams,
      deriveArgon2id,
    );
    try {
      const ark = await openEnvelope(candidate.envelope, passwordKey, {
        accountId: data.accountId,
        keyId: "ark",
        keyVersion: 1,
        type: "password",
      });
      if (candidate.mutationId) {
        await fetch("/api/account/password/change", {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mutationId: candidate.mutationId,
            revokeProductSessions: false,
          }),
        }).catch(() => undefined);
      }
      return {
        accountId: data.accountId,
        ark,
        vaultRevision: data.vault.vaultRevision,
      };
    } catch {
      // Try the other active/staged envelope without revealing which matched.
    } finally {
      passwordKey.fill(0);
    }
  }
  throw new Error("That password could not unlock this Vault.");
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
  const opened = await openArkWithPassword(password);
  const ark = opened.ark;
  try {
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
    ark.fill(0);
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
