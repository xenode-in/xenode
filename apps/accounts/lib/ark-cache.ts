"use client";

import { importProductKey } from "@xenode/crypto-core";
import { clearPersistedKeys } from "@xenode/crypto-react";

/** Accounts-only, per-tab root-key cache. A reload or sign-out clears it. */
const roots = new Map<string, CryptoKey>();
let legacyCleanup: Promise<void> | null = null;

function clearLegacyArk(): Promise<void> {
  // Old releases put a usable root CryptoKey in IndexedDB. New code must
  // attempt removal without ever reading it back into the account session.
  legacyCleanup ??= clearPersistedKeys("accounts-ark");
  return legacyCleanup;
}

export async function cacheAccountRootKey(
  accountId: string,
  ark: Uint8Array,
): Promise<void> {
  await clearLegacyArk();
  const key = await importProductKey(ark);
  roots.clear();
  roots.set(accountId, key);
}

export async function loadCachedAccountRootKey(
  accountId: string,
): Promise<CryptoKey | null> {
  await clearLegacyArk();
  return roots.get(accountId) ?? null;
}

export async function clearCachedAccountRootKey(): Promise<void> {
  roots.clear();
  await clearLegacyArk();
  await clearPersistedKeys("accounts-ark");
}
