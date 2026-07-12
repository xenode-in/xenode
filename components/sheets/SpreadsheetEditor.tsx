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
import { SpreadsheetCommentsPanel, type CommentAnchor } from "./SpreadsheetCommentsPanel";
import { canComment as roleCanComment } from "@/lib/orgs/shareRoles";
import { normalizedToUniver, univerToNormalized, type UniverWorkbookData } from "@/lib/spreadsheets/univerAdapter";
import { SpreadsheetWorkerClient } from "@/lib/spreadsheets/workerClient";
import { SpreadsheetCompatibilityDialog } from "./SpreadsheetCompatibilityDialog";
import { SpreadsheetConflictDialog } from "./SpreadsheetConflictDialog";
import { SpreadsheetHeader, type SpreadsheetSaveState } from "./SpreadsheetHeader";
import { SpreadsheetLoadingState } from "./SpreadsheetLoadingState";

export function SpreadsheetEditor({ loaded, persistence, userId, recoveryKey, onReload, onSaveCopy, onBack, scopedFetch }: { loaded: LoadedWorkbook; persistence: SpreadsheetPersistenceAdapter; userId: string; recoveryKey: CryptoKey; onReload: () => void; onSaveCopy?: (file: File) => void; onBack: () => void; scopedFetch?: typeof fetch }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<any>(null);
  const currentRef = useRef<NormalizedWorkbook>(loaded.workbook);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<SpreadsheetSaveState>(loaded.readOnly ? "read_only" : "saved");
  const [compatibilityOpen, setCompatibilityOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const firstSave = useRef(true);
  // Comment posting mirrors the file permission: share role commenter+, or
  // write access for owner/org members (org guests are read-only → view only).
  const canPostComments = loaded.share ? roleCanComment(loaded.share.role) : !loaded.readOnly;

  const getSelectionAnchor = useCallback((): CommentAnchor | null => {
    try {
      const workbook = apiRef.current?.getActiveWorkbook?.();
      const sheet = workbook?.getActiveSheet?.();
      if (!sheet) return null;
      const range = sheet.getSelection?.()?.getActiveRange?.();
      return {
        sheetId: sheet.getSheetId?.() ?? undefined,
        sheetName: sheet.getSheetName?.() ?? undefined,
        ref: range?.getA1Notation?.() ?? undefined,
      };
    } catch {
      return null;
    }
  }, []);

  const jumpToAnchor = useCallback((anchor: CommentAnchor) => {
    try {
      const workbook = apiRef.current?.getActiveWorkbook?.();
      if (!workbook) return;
      if (anchor.sheetId) {
        const target = workbook.getSheetBySheetId?.(anchor.sheetId);
        if (target) workbook.setActiveSheet?.(target);
      }
      const sheet = workbook.getActiveSheet?.();
      const range = anchor.ref ? sheet?.getRange?.(anchor.ref) : null;
      if (range) {
        workbook.setActiveRange?.(range);
        void apiRef.current?.executeCommand?.("sheet.command.scroll-to-cell", {
          range: {
            startRow: range.getRow?.() ?? 0,
            endRow: range.getRow?.() ?? 0,
            startColumn: range.getColumn?.() ?? 0,
            endColumn: range.getColumn?.() ?? 0,
          },
        });
      }
    } catch {
      /* best-effort navigation */
    }
  }, []);

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
      // Read-only viewers get no editing surfaces at all: no toolbar
      // (formatting/colors), no formula bar (top edit box), no context menu.
      const created = createUniver({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: mergeLocales(enUS) }, presets: [UniverSheetsCorePreset({ container: containerRef.current, header: true, toolbar: !loaded.readOnly, formulaBar: !loaded.readOnly, contextMenu: !loaded.readOnly, footer: { sheetBar: true, statisticBar: true } })] });
      univer = created.univer; apiRef.current = created.univerAPI;
      const fWorkbook = created.univerAPI.createWorkbook(normalizedToUniver(loaded.workbook) as any);
      if (loaded.readOnly) {
        // Truly lock the workbook — the save path being blocked is not enough,
        // a viewer must not be able to type into cells at all. Lock the
        // instance returned by createWorkbook: getActiveWorkbook() can still
        // be null this early, which would silently skip the lock.
        try {
          fWorkbook.setEditable(false);
        } catch (permissionError) {
          console.warn("[sheets] setEditable(false) failed; falling back", permissionError);
          await fWorkbook.getWorkbookPermission?.()?.setReadOnly?.().catch((fallbackError: unknown) => {
            console.error("[sheets] failed to lock read-only workbook", fallbackError);
          });
        }
        // Second layer: a command firewall. The permission point only gates
        // in-cell editing — formatting, clear, insert-sheet, and formula-bar
        // input all run through their own commands. Deny every sheet/doc
        // command except explicitly read-only-safe navigation (throwing
        // inside onBeforeCommandExecute aborts the command).
        const READONLY_ALLOWED_COMMANDS = new Set([
          "sheet.command.copy",
          "sheet.command.set-worksheet-activate",
          "sheet.command.set-scroll-relative",
          "sheet.command.scroll-view",
          "sheet.command.scroll-to-cell",
          "sheet.command.scroll-view-reset",
          "sheet.command.change-zoom-ratio",
          "sheet.command.set-zoom-ratio",
        ]);
        (created.univerAPI as any).onBeforeCommandExecute?.((command: { id?: string; params?: { visible?: boolean } }) => {
          const id = command?.id ?? "";
          const blocked =
            (id === "sheet.operation.set-cell-edit-visible" && command?.params?.visible !== false) ||
            id === "univer.command.undo" ||
            id === "univer.command.redo" ||
            ((id.startsWith("sheet.command.") || id.startsWith("doc.command.")) &&
              !READONLY_ALLOWED_COMMANDS.has(id));
          if (blocked) throw new Error("spreadsheet_read_only");
        });
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

  return <div className="flex h-full min-h-0 flex-col"><SpreadsheetHeader name={loaded.name} workspace={loaded.share ? "Shared with you" : loaded.workspace.type === "personal" ? "Personal workspace" : "Organization workspace"} state={state} onSave={save} onExport={(format) => void exportFile(format)} onUndo={loaded.readOnly ? undefined : () => void apiRef.current?.undo()} onRedo={loaded.readOnly ? undefined : () => void apiRef.current?.redo()} onVersions={loaded.share ? undefined : () => setVersionsOpen(true)} onComments={() => setCommentsOpen((open) => !open)} onBack={onBack} accessSlot={loaded.share && loaded.readOnly ? <div className="mr-1 flex items-center gap-1.5"><Badge variant="secondary">View only</Badge><ShareAccessRequestButton shareId={loaded.share.shareId} currentRole={loaded.share.role}/></div> : undefined}/><div className="flex min-h-0 flex-1">
      <div className="relative min-h-0 flex-1">{!ready && <div className="absolute inset-0 z-10 bg-background"><SpreadsheetLoadingState label="Starting spreadsheet editor"/></div>}<div ref={containerRef} className="h-full w-full"/></div>
      {commentsOpen && <SpreadsheetCommentsPanel objectId={loaded.objectId} dek={loaded.dek} canComment={canPostComments} scopedFetch={scopedFetch} onClose={() => setCommentsOpen(false)} getSelectionAnchor={getSelectionAnchor} onJumpToAnchor={jumpToAnchor}/>}
    </div>
    <SpreadsheetCompatibilityDialog open={compatibilityOpen} report={loaded.compatibility} onCancel={() => { setCompatibilityOpen(false); setState("dirty"); }} onContinue={() => { setCompatibilityOpen(false); void performSave(); }}/>
    <SpreadsheetConflictDialog open={conflictOpen} onCancel={() => setConflictOpen(false)} onReload={() => { setConflictOpen(false); onReload(); }} onDownload={() => void downloadLocal(false)} onSaveCopy={() => void downloadLocal(true)}/>
    {!loaded.share && <FileVersionsDialog fileId={loaded.objectId} fileName={loaded.name} isOpen={versionsOpen} onClose={() => setVersionsOpen(false)} onRestored={() => { setVersionsOpen(false); if (state === "dirty" && !confirm("Restoring will discard unsaved local edits. Continue?")) return; onReload(); }}/>}
  </div>;
}

