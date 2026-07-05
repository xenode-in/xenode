"use client";

import { useEffect, useState } from "react";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useCrypto } from "@/contexts/CryptoContext";
import { unwrapSpaceKeyGrant } from "@/lib/orgs/spaceKeyClient";

export interface WorkspaceSpaceKeyState {
  rawSpaceKey: Uint8Array | null;
  cryptoKey: CryptoKey | null;
  keyVersion: number | null;
  isWorkspaceEncrypted: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useWorkspaceSpaceKey(): WorkspaceSpaceKeyState {
  const workspace = useOptionalWorkspace();
  const { privateKey } = useCrypto();
  const [rawSpaceKey, setRawSpaceKey] = useState<Uint8Array | null>(null);
  const [keyVersion, setKeyVersion] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const driveScope = workspace?.driveScope ?? { type: "personal" as const };
  const isWorkspaceEncrypted = driveScope.type !== "personal";

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setRawSpaceKey(null);
      setKeyVersion(null);
      setError(null);

      if (!isWorkspaceEncrypted) return;
      if (!privateKey) {
        setError("Vault locked. Please unlock first.");
        return;
      }

      setIsLoading(true);
      try {
        const params =
          driveScope.type === "team"
            ? `?teamId=${encodeURIComponent(driveScope.teamId)}`
            : "";
        const res = await fetch(`/api/orgs/${driveScope.orgId}/keys${params}`, {
          headers: workspace?.scopedHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Failed to load workspace key");
        }
        const grant = Array.isArray(data.grants) ? data.grants[0] : null;
        if (!grant?.wrappedSpaceKey || !grant?.keyVersion) {
          throw new Error("Workspace encryption key is not available");
        }
        const raw = await unwrapSpaceKeyGrant({
          wrappedSpaceKey: grant.wrappedSpaceKey,
          privateKey,
        });
        if (!cancelled) {
          setRawSpaceKey(raw);
          setKeyVersion(Number(grant.keyVersion));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Workspace key failed");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [
    isWorkspaceEncrypted,
    privateKey,
    workspace,
    driveScope.type,
    driveScope.type === "personal" ? "" : driveScope.orgId,
    driveScope.type === "team" ? driveScope.teamId : "",
  ]);

  const [importedKey, setImportedKey] = useState<CryptoKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!rawSpaceKey) {
        setImportedKey(null);
        return;
      }
      const key = await crypto.subtle.importKey(
        "raw",
        rawSpaceKey.buffer.slice(
          rawSpaceKey.byteOffset,
          rawSpaceKey.byteOffset + rawSpaceKey.byteLength,
        ) as ArrayBuffer,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
      );
      if (!cancelled) setImportedKey(key);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [rawSpaceKey]);

  return {
    rawSpaceKey,
    cryptoKey: importedKey,
    keyVersion,
    isWorkspaceEncrypted,
    isLoading,
    error,
  };
}
