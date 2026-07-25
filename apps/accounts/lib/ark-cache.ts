"use client";

import { importProductKey } from "@xenode/crypto-core";
import {
  clearPersistedKeys,
  loadPersistedKey,
  savePersistedKey,
} from "@xenode/crypto-react";

/**
 * Device-local cache of the Account Root Key (ARK).
 *
 * After the vault is created/unlocked in this browser, the ARK is imported as a
 * NON-EXTRACTABLE AES-GCM CryptoKey and stored in IndexedDB (raw bytes never
 * touch disk). The key-handoff broker can then unwrap product keys for Drive/
 * Photos WITHOUT re-prompting the vault password on this device — matching the
 * v1 "authenticated ⇒ unlocked" experience.
 *
 * Security note: like v1, this trades the vault-password gate for convenience —
 * a hijacked logged-in browser can unwrap keys. `clearCachedAccountRootKey()`
 * (sign-out / lock) removes it.
 */
const ARK_PRODUCT = "accounts-ark";

export async function cacheAccountRootKey(
  accountId: string,
  ark: Uint8Array,
): Promise<void> {
  const key = await importProductKey(ark);
  await savePersistedKey(ARK_PRODUCT, accountId, key);
}

export function loadCachedAccountRootKey(
  accountId: string,
): Promise<CryptoKey | null> {
  return loadPersistedKey(ARK_PRODUCT, accountId);
}

export async function clearCachedAccountRootKey(): Promise<void> {
  await clearPersistedKeys(ARK_PRODUCT);
}
