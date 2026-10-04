"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useOptionalCrypto } from "@/contexts/CryptoContext";
import {
  forgetWorkspaceKeyring,
  keyringWithVersion,
  keyVersionOf,
  loadWorkspaceKeyring,
  workspaceSpaceId,
  type WorkspaceKeyVersion,
  type WorkspaceKeyring,
} from "@/lib/orgs/workspaceKeyring";

export interface WorkspaceSpaceKeyState {
  isWorkspaceEncrypted: boolean;
  isLoading: boolean;
  error: string | null;
  /** Newest workspace key version: new records are created with it. */
  current: WorkspaceKeyVersion | null;
  /**
   * The workspace key version a record was created with (its
   * `spaceKeyVersion`); reloads once for a record newer than the keyring.
   */
  keyFor: (version: number | null | undefined) => Promise<WorkspaceKeyVersion | null>;
  /** `keyFor(version)?.rawKey`: the key the record's DEKs are wrapped with. */
  rawKeyFor: (version: number | null | undefined) => Promise<Uint8Array | null>;
  /** Metadata key for an existing record: personal, or its workspace version. */
  metadataKeyFor: (version: number | null | undefined) => CryptoKey | null;
  /** Metadata key for a new record: personal, or the newest workspace version. */
  writeMetadataKey: CryptoKey | null;
  /** Forget the cached keyring and load it again (after a rotation). */
  reload: () => Promise<void>;
}

export function useWorkspaceSpaceKey(): WorkspaceSpaceKeyState {
  const workspace = useOptionalWorkspace();
  const cryptoContext = useOptionalCrypto();
  const privateKey = cryptoContext?.privateKey ?? null;
  const personalMetadataKey = cryptoContext?.metadataKey ?? null;
  // Results are keyed by vault key and Space, so a scope or vault change never
  // shows the previous keyring and the effect never resets state itself.
  const [loaded, setLoaded] = useState<{
    privateKey: CryptoKey;
    spaceId: string;
    keyring: WorkspaceKeyring | null;
    error: string | null;
  } | null>(null);
  const wantedVersion = useRef(0);

  const driveScope = workspace?.driveScope ?? { type: "personal" as const };
  const isWorkspaceEncrypted = driveScope.type !== "personal";
  const orgId = driveScope.type === "personal" ? "" : driveScope.orgId;
  const teamId = driveScope.type === "team" ? driveScope.teamId : null;
  const spaceId = isWorkspaceEncrypted ? workspaceSpaceId(orgId, teamId) : null;
  const result =
    loaded && loaded.privateKey === privateKey && loaded.spaceId === spaceId ? loaded : null;
  const keyring = result?.keyring ?? null;
  const isLoading = Boolean(spaceId && privateKey && !result);
  const error = !isWorkspaceEncrypted
    ? null
    : !privateKey
      ? "Vault locked. Please unlock first."
      : (result?.error ?? null);

  useEffect(() => {
    if (!spaceId || !privateKey) return;
    let cancelled = false;
    loadWorkspaceKeyring({ orgId, teamId, privateKey })
      .then((next) => {
        if (!cancelled) setLoaded({ privateKey, spaceId, keyring: next, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoaded({
            privateKey,
            spaceId,
            keyring: null,
            error: err instanceof Error ? err.message : "Workspace key failed",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId, privateKey, orgId, teamId]);

  const store = useCallback(
    (next: WorkspaceKeyring) => {
      if (!privateKey) return;
      setLoaded((previous) =>
        previous?.keyring === next
          ? previous
          : { privateKey, spaceId: next.spaceId, keyring: next, error: null },
      );
    },
    [privateKey],
  );

  const withVersion = useCallback(
    async (version: number) => {
      if (!privateKey) return null;
      const next = await keyringWithVersion({ orgId, teamId, privateKey }, version);
      store(next);
      return next;
    },
    [privateKey, orgId, teamId, store],
  );

  // A record newer than this keyring was rendered: reload outside render.
  useEffect(() => {
    if (keyring && wantedVersion.current > keyring.current.keyVersion) {
      void withVersion(wantedVersion.current).catch(() => undefined);
    }
  });

  const keyFor = useCallback(
    async (version: number | null | undefined) => {
      if (!keyring || !version) return null;
      const known = keyVersionOf(keyring, version);
      if (known || version <= keyring.current.keyVersion) return known;
      const fresh = await withVersion(version);
      return fresh ? keyVersionOf(fresh, version) : null;
    },
    [keyring, withVersion],
  );

  const rawKeyFor = useCallback(
    async (version: number | null | undefined) => (await keyFor(version))?.rawKey ?? null,
    [keyFor],
  );

  const metadataKeyFor = useCallback(
    (version: number | null | undefined) => {
      if (!isWorkspaceEncrypted) return personalMetadataKey;
      if (!keyring || !version) return null;
      if (version > keyring.current.keyVersion) {
        wantedVersion.current = Math.max(wantedVersion.current, version);
      }
      return keyVersionOf(keyring, version)?.metadataKey ?? null;
    },
    [isWorkspaceEncrypted, keyring, personalMetadataKey],
  );

  const reload = useCallback(async () => {
    if (!privateKey || !keyring) return;
    forgetWorkspaceKeyring(privateKey, keyring.spaceId);
    store(await loadWorkspaceKeyring({ orgId, teamId, privateKey }));
  }, [privateKey, keyring, orgId, teamId, store]);

  return {
    isWorkspaceEncrypted,
    isLoading,
    error,
    current: keyring?.current ?? null,
    keyFor,
    rawKeyFor,
    metadataKeyFor,
    writeMetadataKey: isWorkspaceEncrypted
      ? (keyring?.current.metadataKey ?? null)
      : personalMetadataKey,
    reload,
  };
}
