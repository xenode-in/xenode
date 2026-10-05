import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getSearchIndex } from "@/lib/db/local";
import { createSyncRunner } from "@/lib/db/sync-runner";
import { decryptMetadataString } from "@/lib/crypto/fileEncryption";
import { useSession } from "@/lib/auth/client";
import { useCrypto } from "@/contexts/CryptoContext";
import { useOptionalWorkspace, driveScopeSpaceId } from "@/contexts/WorkspaceContext";
import { useWorkspaceSpaceKey } from "@/lib/orgs/useWorkspaceSpaceKey";

const subscribeNone = () => () => {};
const idle = () => false;
const noSearch = () => null;
export function useSyncManager() {
  const { data: session } = useSession();
  const cryptoContext = useCrypto();
  const workspace = useOptionalWorkspace();
  const { isWorkspaceEncrypted, current: workspaceCurrent, keyFor } = useWorkspaceSpaceKey();
  const accountId = session?.user?.id ?? "";
  const spaceId = accountId ? driveScopeSpaceId(workspace?.driveScope ?? { type: "personal" }, accountId) : "";
  const unlocked = cryptoContext.isUnlocked;
  const runner = useMemo(() => {
    if (!accountId || !spaceId) return null;
    return createSyncRunner({
      scope: { accountId, spaceId },
      canIndex: unlocked && Boolean(isWorkspaceEncrypted ? workspaceCurrent?.metadataKey : cryptoContext.metadataKey),
      async decrypt(file) {
        const key = isWorkspaceEncrypted
          ? (await keyFor(file.spaceKeyVersion))?.metadataKey ?? null : cryptoContext.metadataKey;
        const encrypted = file.encryptedDisplayName ?? file.encryptedName;
        const name = encrypted ? await decryptMetadataString(encrypted, key, { fileId: file.id, purpose: "name" }) : "Encrypted File";
        const tags = await Promise.all(file.tags.map((tag) => decryptMetadataString(tag, key, { fileId: file.id, purpose: "tags" })));
        return { ...file, name, tags: tags.filter((tag) => tag !== "Encrypted File") };
      },
    });
  }, [accountId, spaceId, unlocked, cryptoContext.metadataKey, isWorkspaceEncrypted, workspaceCurrent, keyFor]);
  const search = useMemo(() => accountId && spaceId ? getSearchIndex(accountId, spaceId) : null, [accountId, spaceId]);
  const isSyncing = useSyncExternalStore(runner?.subscribe ?? subscribeNone, runner?.snapshot ?? idle, idle);
  const searchSnapshot = useSyncExternalStore(search?.subscribe ?? subscribeNone, search?.snapshot ?? noSearch, noSearch);
  useEffect(() => {
    if (!runner) return;
    void runner.run().catch(() => {});
    const interval = setInterval(() => void runner.run().catch(() => {}), 60_000);
    return () => { clearInterval(interval); runner.dispose(); };
  }, [runner]);
  return { isSyncing, sync: () => runner?.run(), searchSnapshot, unlocked };
}
