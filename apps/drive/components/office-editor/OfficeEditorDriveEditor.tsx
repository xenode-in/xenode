"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileSpreadsheet, ShieldCheck } from "lucide-react";
import { useSession } from "@/lib/auth/client";
import { useCrypto } from "@/contexts/CryptoContext";
import {
  WorkspaceScopeProvider,
  useWorkspace,
  type DriveScope,
} from "@/contexts/WorkspaceContext";
import { useWorkspaceSpaceKey } from "@/lib/orgs/useWorkspaceSpaceKey";
import { getDb } from "@/lib/db/local";
import { SpreadsheetLoadingState } from "@/components/sheets/SpreadsheetLoadingState";
import { OnlyOfficeSpreadsheetEditor } from "./OnlyOfficeSpreadsheetEditor";
import { XenodeBinaryPersistenceAdapter } from "@/lib/office-editor/persistence";
import { DirectShareBinaryPersistenceAdapter } from "@/lib/office-editor/sharePersistence";
import type {
  BinaryPersistenceAdapter,
  LoadedBinaryWorkbook,
  SpreadsheetWorkspace,
} from "@/lib/office-editor/types";
import { ONLYOFFICE_ARTIFACT_VERSION } from "@/lib/office-editor/config";

export function OfficeEditorDriveEditor() {
  const search = useSearchParams();
  const orgId = search.get("orgId");
  const teamId = search.get("teamId");
  const driveScope: DriveScope = orgId
    ? teamId
      ? { type: "team", orgId, teamId }
      : { type: "organization", orgId }
    : { type: "personal" };

  return (
    <WorkspaceScopeProvider driveScope={driveScope}>
      <OfficeEditorDriveEditorInner />
    </WorkspaceScopeProvider>
  );
}

function OfficeEditorDriveEditorInner() {
  const search = useSearchParams();
  const objectId = search.get("id") ?? "";
  const shareId = search.get("shareId");
  const { data: session } = useSession();
  const { privateKey, metadataKey, isUnlocked, setModalOpen } = useCrypto();
  const workspaceContext = useWorkspace();
  const space = useWorkspaceSpaceKey();
  const [workbookName, setWorkbookName] = useState("Encrypted workbook");
  const [editorMessage, setEditorMessage] = useState<string | null>(null);

  const workspace = useMemo<SpreadsheetWorkspace>(() => {
    const scope = workspaceContext.driveScope;
    if (scope.type === "personal") {
      return {
        type: "personal",
        workspaceId: `ws_personal_${session?.user.id ?? ""}`,
      };
    }
    if (scope.type === "team") {
      return {
        type: "team",
        workspaceId: scope.orgId,
        organizationId: scope.orgId,
        teamId: scope.teamId,
      };
    }
    return {
      type: "organization",
      workspaceId: scope.orgId,
      organizationId: scope.orgId,
    };
  }, [session?.user.id, workspaceContext.driveScope]);

  const persistence = useMemo<BinaryPersistenceAdapter | null>(() => {
    if (shareId) {
      return privateKey
        ? new DirectShareBinaryPersistenceAdapter({ shareId, privateKey })
        : null;
    }
    if (!privateKey || !metadataKey) return null;
    if (workspace.type !== "personal" && (!space.rawSpaceKey || !space.cryptoKey)) {
      return null;
    }
    return new XenodeBinaryPersistenceAdapter({
      fetch: workspaceContext.scopedFetch as typeof fetch,
      privateKey,
      metadataKey,
      workspace,
      workspaceSpaceKey: space.rawSpaceKey,
      workspaceMetadataKey: space.cryptoKey,
    });
  }, [
    metadataKey,
    privateKey,
    shareId,
    space.cryptoKey,
    space.rawSpaceKey,
    workspace,
    workspaceContext.scopedFetch,
  ]);

  useEffect(() => {
    if ((objectId || shareId) && !isUnlocked) setModalOpen(true);
  }, [isUnlocked, objectId, setModalOpen, shareId]);

  useEffect(() => {
    return () => persistence?.dispose?.();
  }, [persistence]);

  const handleLoaded = (loaded: LoadedBinaryWorkbook) => {
      setWorkbookName(loaded.name);
      if (!session?.user.id) return;
      void getDb(session.user.id).spreadsheetRecents.put({
        id: `${loaded.workspace.workspaceId}:${loaded.objectId}`,
        userId: session.user.id,
        objectId: loaded.objectId,
        workspaceId: loaded.workspace.workspaceId,
        organizationId:
          loaded.workspace.type === "personal"
            ? undefined
            : loaded.workspace.organizationId,
        lastOpenedAt: Date.now(),
      });
  };

  if (!objectId && !shareId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-medium">No spreadsheet was selected</p>
        <Link href="/office-editor" className="text-sm underline">
          Back to spreadsheets
        </Link>
      </div>
    );
  }

  if (!session?.user.id || !persistence) {
    return <SpreadsheetLoadingState label="Unlocking encrypted workbook" />;
  }

  return (
    <main className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="rounded-lg bg-emerald-600 p-1.5 text-white">
            <FileSpreadsheet className="size-4" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">{workbookName}</span>
              <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {ONLYOFFICE_ARTIFACT_VERSION}
              </span>
            </div>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3" />
              Decrypted and edited only in this browser
            </span>
          </div>
        </div>
      </header>
      {editorMessage && (
        <div className="border-b bg-amber-500/5 px-4 py-2 text-xs text-amber-700">
          {editorMessage}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <OnlyOfficeSpreadsheetEditor
          objectId={objectId || shareId || ""}
          adapter={persistence}
          theme="light"
          onLoaded={handleLoaded}
          onFallbackToV1={(reason) => {
            setEditorMessage(
              `The Office editor is temporarily unavailable (${reason}). Please reload to try again.`,
            );
          }}
          onError={(code, message) =>
            setEditorMessage(`Editor: ${code}${message ? ` — ${message}` : ""}`)
          }
        />
      </div>
    </main>
  );
}
