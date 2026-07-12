"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth/client";
import { useCrypto } from "@/contexts/CryptoContext";
import { WorkspaceScopeProvider, useWorkspace, type DriveScope } from "@/contexts/WorkspaceContext";
import { useWorkspaceSpaceKey } from "@/lib/orgs/useWorkspaceSpaceKey";
import { useUpload } from "@/contexts/UploadContext";
import { getDb } from "@/lib/db/local";
import type { LoadedWorkbook, SpreadsheetWorkspace } from "@/lib/spreadsheets/types";
import { XenodeSpreadsheetPersistenceAdapter } from "@/lib/spreadsheets/persistence";
import { DirectShareSpreadsheetPersistenceAdapter } from "@/lib/spreadsheets/sharePersistence";
import { SpreadsheetEditor } from "@/components/sheets/SpreadsheetEditor";
import { SpreadsheetLoadingState } from "@/components/sheets/SpreadsheetLoadingState";

export default function SheetsEditorPage() {
  const search = useSearchParams();
  const orgId = search.get("orgId"); const teamId = search.get("teamId");
  const driveScope: DriveScope = orgId ? (teamId ? { type: "team", orgId, teamId } : { type: "organization", orgId }) : { type: "personal" };
  return <WorkspaceScopeProvider driveScope={driveScope}><SheetsEditorInner/></WorkspaceScopeProvider>;
}

function SheetsEditorInner() {
  const search = useSearchParams(); const router = useRouter(); const objectId = search.get("id") ?? "";
  const bucketId = search.get("bucketId"); const prefix = search.get("prefix");
  const shareId = search.get("shareId");
  const { data: session } = useSession(); const { privateKey, metadataKey, isUnlocked, setModalOpen } = useCrypto(); const workspaceContext = useWorkspace(); const space = useWorkspaceSpaceKey(); const { addTasks } = useUpload();
  const [loaded, setLoaded] = useState<LoadedWorkbook | null>(null); const [error, setError] = useState<string | null>(null); const [reloadKey, setReloadKey] = useState(0);
  const workspace = useMemo<SpreadsheetWorkspace>(() => workspaceContext.driveScope.type === "personal" ? { type: "personal", workspaceId: `ws_personal_${session?.user.id ?? ""}` } : workspaceContext.driveScope.type === "team" ? { type: "team", workspaceId: workspaceContext.driveScope.orgId, organizationId: workspaceContext.driveScope.orgId, teamId: workspaceContext.driveScope.teamId } : { type: "organization", workspaceId: workspaceContext.driveScope.orgId, organizationId: workspaceContext.driveScope.orgId }, [session?.user.id, workspaceContext.driveScope]);
  const persistence = useMemo(() => {
    if (!privateKey || !metadataKey) return null;
    if (shareId) return new DirectShareSpreadsheetPersistenceAdapter({ shareId, privateKey });
    if (workspace.type !== "personal" && (!space.rawSpaceKey || !space.cryptoKey)) return null;
    return new XenodeSpreadsheetPersistenceAdapter({ fetch: workspaceContext.scopedFetch as typeof fetch, privateKey, metadataKey, workspace, workspaceSpaceKey: space.rawSpaceKey, workspaceMetadataKey: space.cryptoKey });
  }, [metadataKey, privateKey, shareId, space.cryptoKey, space.rawSpaceKey, workspace, workspaceContext.scopedFetch]);
  useEffect(() => {
    // Shared spreadsheets need the recipient's vault key to unwrap the share key.
    if (shareId && !isUnlocked) setModalOpen(true);
  }, [isUnlocked, setModalOpen, shareId]);
  useEffect(() => {
    if (!persistence || !(objectId || shareId) || !session?.user.id) return; const controller = new AbortController();
    // Matches the repository client-detail loading convention.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded(null); setError(null);
    persistence.load(objectId, controller.signal).then(async (value) => { setLoaded(value); await getDb(session.user.id).spreadsheetRecents.put({ id: `${value.workspace.workspaceId}:${value.objectId}`, userId: session.user.id, objectId: value.objectId, workspaceId: value.workspace.workspaceId, organizationId: value.workspace.type === "personal" ? undefined : value.workspace.organizationId, lastOpenedAt: Date.now() }); }).catch((reason) => { if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "spreadsheet_load_failed"); });
    return () => { controller.abort(); persistence.dispose?.(); };
  }, [objectId, persistence, reloadKey, session?.user.id, shareId, workspace]);
  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  if (!objectId && !shareId) return <div className="flex h-full items-center justify-center text-sm">No spreadsheet object was selected.</div>;
  if (error) return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"><p className="font-medium">Unable to open spreadsheet</p><p className="text-sm text-muted-foreground">{error}</p><button className="text-sm underline" onClick={() => router.push(shareId ? "/dashboard/shared-with-me" : "/sheets")}>{shareId ? "Back to shared files" : "Back to spreadsheets"}</button></div>;
  if (!loaded || !persistence || !session?.user.id || !metadataKey) return <SpreadsheetLoadingState/>;
  const recoveryKey = shareId || workspace.type === "personal" ? metadataKey : space.cryptoKey!;
  return <SpreadsheetEditor loaded={loaded} persistence={persistence} userId={session.user.id} recoveryKey={recoveryKey} onReload={reload} onBack={() => router.push(shareId ? "/dashboard/shared-with-me" : "/sheets")} onSaveCopy={!shareId && bucketId && prefix ? (file) => addTasks([new File([file], file.name.replace(/\.xlsx$/i, " copy.xlsx"), { type: file.type })], bucketId, prefix) : undefined}/>;
}

