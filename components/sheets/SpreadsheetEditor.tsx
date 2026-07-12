/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FileVersionsDialog } from "@/components/dashboard/FileVersionsDialog";
import { deleteSpreadsheetDraft, saveEncryptedSpreadsheetDraft } from "@/lib/spreadsheets/recovery";
import { SpreadsheetConflictError } from "@/lib/spreadsheets/persistence";
import type { LoadedWorkbook, NormalizedWorkbook, SpreadsheetExportFormat, SpreadsheetPersistenceAdapter } from "@/lib/spreadsheets/types";
import { Badge } from "@/components/ui/badge";
import { ShareAccessRequestButton } from "@/components/ShareAccessRequestButton";
import { normalizedToUniver, univerToNormalized, type UniverWorkbookData } from "@/lib/spreadsheets/univerAdapter";
import { SpreadsheetWorkerClient } from "@/lib/spreadsheets/workerClient";
import { SpreadsheetCompatibilityDialog } from "./SpreadsheetCompatibilityDialog";
import { SpreadsheetConflictDialog } from "./SpreadsheetConflictDialog";
import { SpreadsheetHeader, type SpreadsheetSaveState } from "./SpreadsheetHeader";
import { SpreadsheetLoadingState } from "./SpreadsheetLoadingState";

export function SpreadsheetEditor({ loaded, persistence, userId, recoveryKey, onReload, onSaveCopy, onBack }: { loaded: LoadedWorkbook; persistence: SpreadsheetPersistenceAdapter; userId: string; recoveryKey: CryptoKey; onReload: () => void; onSaveCopy?: (file: File) => void; onBack: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<any>(null);
  const currentRef = useRef<NormalizedWorkbook>(loaded.workbook);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<SpreadsheetSaveState>(loaded.readOnly ? "read_only" : "saved");
  const [compatibilityOpen, setCompatibilityOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const firstSave = useRef(true);

  const snapshot = useCallback(() => {
    const raw = apiRef.current?.getActiveWorkbook()?.getSnapshot() as UniverWorkbookData | undefined;
    if (raw) currentRef.current = univerToNormalized(raw);
    return currentRef.current;
  }, []);
  const persistDraftSoon = useCallback(() => {
    if (loaded.readOnly) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(async () => {
      const bytes = new TextEncoder().encode(JSON.stringify(snapshot())).buffer;
      await saveEncryptedSpreadsheetDraft({ userId, workspaceId: loaded.workspace.workspaceId, objectId: loaded.objectId, baseRevision: loaded.revision, plaintext: bytes, recoveryKey }).catch(() => {});
      if (!navigator.onLine) setState("offline");
    }, 1200);
  }, [loaded, recoveryKey, snapshot, userId]);

  useEffect(() => {
    let disposed = false; let commandSubscription: { dispose(): void } | undefined; let univer: { dispose(): void } | undefined;
    (async () => {
      const [{ createUniver, LocaleType, mergeLocales }, { UniverSheetsCorePreset }, { default: enUS }] = await Promise.all([import("@univerjs/presets"), import("@univerjs/preset-sheets-core"), import("@univerjs/preset-sheets-core/locales/en-US")]);
      if (disposed || !containerRef.current) return;
      const created = createUniver({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: mergeLocales(enUS) }, presets: [UniverSheetsCorePreset({ container: containerRef.current, header: true, toolbar: true, formulaBar: true, footer: { sheetBar: true, statisticBar: true } })] });
      univer = created.univer; apiRef.current = created.univerAPI;
      created.univerAPI.createWorkbook(normalizedToUniver(loaded.workbook) as any);
      if (loaded.readOnly) {
        // Truly lock the workbook — the save path being blocked is not enough,
        // a viewer must not be able to type into cells at all.
        const fWorkbook = created.univerAPI.getActiveWorkbook?.();
        try {
          fWorkbook?.setEditable(false);
        } catch {
          await fWorkbook?.getWorkbookPermission?.()?.setReadOnly?.().catch(() => {});
        }
      }
      commandSubscription = created.univerAPI.addEvent(created.univerAPI.Event.CommandExecuted, (event: { id?: string }) => {
        const id = event.id ?? "";
        if (!id.includes("command") || /activate|selection|scroll/i.test(id)) return;
        setState(loaded.readOnly ? "read_only" : "dirty"); persistDraftSoon();
      });
      setReady(true);
    })().catch(() => toast.error("The spreadsheet renderer could not start."));
    return () => { disposed = true; if (draftTimer.current) clearTimeout(draftTimer.current); commandSubscription?.dispose(); univer?.dispose(); apiRef.current = null; };
  }, [loaded.readOnly, loaded.workbook, persistDraftSoon]);

  const performSave = useCallback(async () => {
    try {
      setState("saving");
      const result = await persistence.save({ loaded, workbook: snapshot() });
      loaded.revision = result.revision;
      await deleteSpreadsheetDraft(userId, loaded.workspace.workspaceId, loaded.objectId);
      firstSave.current = false; setState("saved"); toast.success("Encrypted spreadsheet saved");
    } catch (error) {
      if (error instanceof SpreadsheetConflictError) { setState("conflict"); setConflictOpen(true); return; }
      setState(navigator.onLine ? "failed" : "offline"); toast.error("Save failed; your encrypted local draft is retained.");
    }
  }, [loaded, persistence, snapshot, userId]);
  const save = useCallback(() => {
    if (firstSave.current && loaded.compatibility.hasUnsupportedFeatures) { setCompatibilityOpen(true); return; }
    void performSave();
  }, [loaded.compatibility.hasUnsupportedFeatures, performSave]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); save(); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [save]);
  const createExportFile = useCallback(async (format: SpreadsheetExportFormat) => {
    const worker = new SpreadsheetWorkerClient();
    try {
      const buffer = await worker.export(snapshot(), undefined, format);
      const baseName = loaded.name.replace(/\.(xlsx|xls|csv|tsv|ods)$/i, "");
      const mimeTypes: Record<SpreadsheetExportFormat, string> = {
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        xls: "application/vnd.ms-excel",
        csv: "text/csv;charset=utf-8",
        tsv: "text/tab-separated-values;charset=utf-8",
        ods: "application/vnd.oasis.opendocument.spreadsheet",
      };
      return new File([buffer], baseName + "." + format, {
        type: mimeTypes[format],
      });
    } finally {
      worker.dispose();
    }
  }, [loaded.name, snapshot]);

  const downloadFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  const exportFile = useCallback(async (format: SpreadsheetExportFormat) => {
    const file = await createExportFile(format);
    downloadFile(file);
    if (format === "csv" || format === "tsv") {
      toast.info("CSV and TSV exports contain the first worksheet only.");
    } else {
      toast.success("Exported " + file.name);
    }
  }, [createExportFile, downloadFile]);

  const downloadLocal = useCallback(async (saveCopy: boolean) => {
    const file = await createExportFile("xlsx");
    if (saveCopy && onSaveCopy) onSaveCopy(file);
    else downloadFile(file);
  }, [createExportFile, downloadFile, onSaveCopy]);

  return <div className="flex h-full min-h-0 flex-col"><SpreadsheetHeader name={loaded.name} workspace={loaded.share ? "Shared with you" : loaded.workspace.type === "personal" ? "Personal workspace" : "Organization workspace"} state={state} onSave={save} onExport={(format) => void exportFile(format)} onUndo={() => void apiRef.current?.undo()} onRedo={() => void apiRef.current?.redo()} onVersions={loaded.share ? undefined : () => setVersionsOpen(true)} onBack={onBack} accessSlot={loaded.share && loaded.readOnly ? <div className="mr-1 flex items-center gap-1.5"><Badge variant="secondary">View only</Badge><ShareAccessRequestButton shareId={loaded.share.shareId} currentRole={loaded.share.role}/></div> : undefined}/><div className="relative min-h-0 flex-1">{!ready && <div className="absolute inset-0 z-10 bg-background"><SpreadsheetLoadingState label="Starting spreadsheet editor"/></div>}<div ref={containerRef} className="h-full w-full"/></div>
    <SpreadsheetCompatibilityDialog open={compatibilityOpen} report={loaded.compatibility} onCancel={() => { setCompatibilityOpen(false); setState("dirty"); }} onContinue={() => { setCompatibilityOpen(false); void performSave(); }}/>
    <SpreadsheetConflictDialog open={conflictOpen} onCancel={() => setConflictOpen(false)} onReload={() => { setConflictOpen(false); onReload(); }} onDownload={() => void downloadLocal(false)} onSaveCopy={() => void downloadLocal(true)}/>
    {!loaded.share && <FileVersionsDialog fileId={loaded.objectId} fileName={loaded.name} isOpen={versionsOpen} onClose={() => setVersionsOpen(false)} onRestored={() => { setVersionsOpen(false); if (state === "dirty" && !confirm("Restoring will discard unsaved local edits. Continue?")) return; onReload(); }}/>}
  </div>;
}

