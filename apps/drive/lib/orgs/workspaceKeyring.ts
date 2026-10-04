"use client";

import { deriveDriveMetadataKey } from "@/lib/crypto/productKeys";
import { organizationSpaceId, teamSpaceId } from "@xenode/spaces/ids";
import { unwrapSpaceKeyring } from "./spaceKeyClient";

/**
 * A workspace record keeps the Space key version it was created with
 * (`spaceKeyVersion`): its DEKs, revisions, names, tags, thumbnails and
 * metadata all use that version, so every lookup is exact.
 */
export interface WorkspaceKeyVersion {
  keyVersion: number;
  rawKey: Uint8Array;
  /** HKDF purpose key: the raw Space key never encrypts metadata itself. */
  metadataKey: CryptoKey;
}

export interface WorkspaceKeyring {
  spaceId: string;
  /** Newest version: new records are created with it. */
  current: WorkspaceKeyVersion;
  /** Newest first. */
  versions: WorkspaceKeyVersion[];
}

export interface WorkspaceKeyringScope {
  orgId: string;
  teamId?: string | null;
  privateKey: CryptoKey;
}

// One load per vault key and Space, shared by every row, preview and loader.
const keyrings = new WeakMap<CryptoKey, Map<string, Promise<WorkspaceKeyring>>>();

export function workspaceSpaceId(orgId: string, teamId?: string | null): string {
  return teamId ? teamSpaceId(orgId, teamId) : organizationSpaceId(orgId);
}

export function loadWorkspaceKeyring(scope: WorkspaceKeyringScope): Promise<WorkspaceKeyring> {
  const spaceId = workspaceSpaceId(scope.orgId, scope.teamId);
  let bySpace = keyrings.get(scope.privateKey);
  if (!bySpace) {
    bySpace = new Map();
    keyrings.set(scope.privateKey, bySpace);
  }
  const cached = bySpace.get(spaceId);
  if (cached) return cached;
  const loading = fetchKeyring(spaceId, scope);
  bySpace.set(spaceId, loading);
  loading.catch(() => {
    if (bySpace.get(spaceId) === loading) bySpace.delete(spaceId);
  });
  return loading;
}

/**
 * The keyring, reloaded once if a record was created with a version newer
 * than the cached copy (another member rotated the key meanwhile).
 */
export async function keyringWithVersion(
  scope: WorkspaceKeyringScope,
  version: number,
): Promise<WorkspaceKeyring> {
  const keyring = await loadWorkspaceKeyring(scope);
  if (keyring.current.keyVersion >= version) return keyring;
  const bySpace = keyrings.get(scope.privateKey);
  const cached = bySpace?.get(keyring.spaceId);
  if (!cached || (await cached) === keyring) bySpace?.delete(keyring.spaceId);
  return loadWorkspaceKeyring(scope);
}

/** Drop a cached keyring, e.g. after the server refused a stale version. */
export function forgetWorkspaceKeyring(privateKey: CryptoKey, spaceId: string): void {
  keyrings.get(privateKey)?.delete(spaceId);
}

export function keyVersionOf(
  keyring: WorkspaceKeyring,
  version: number | null | undefined,
): WorkspaceKeyVersion | null {
  return keyring.versions.find((entry) => entry.keyVersion === version) ?? null;
}

async function fetchKeyring(
  spaceId: string,
  scope: WorkspaceKeyringScope,
): Promise<WorkspaceKeyring> {
  const query = scope.teamId ? `?teamId=${encodeURIComponent(scope.teamId)}` : "";
  const res = await fetch(`/api/orgs/${encodeURIComponent(scope.orgId)}/keys${query}`);
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    keys?: Array<{ wrappedKey: string; keyVersion: number }>;
  };
  if (!res.ok) throw new Error(data.error || "Failed to load workspace key");
  const keyring = await unwrapSpaceKeyring({
    keys: Array.isArray(data.keys) ? data.keys : [],
    privateKey: scope.privateKey,
  });
  if (!keyring.length) throw new Error("Workspace encryption key is not available");
  const versions = await Promise.all(
    keyring.map(async (entry) => ({
      keyVersion: entry.keyVersion,
      rawKey: entry.rawSpaceKey,
      metadataKey: await deriveDriveMetadataKey(entry.rawSpaceKey, spaceId),
    })),
  );
  return { spaceId, current: versions[0], versions };
}
