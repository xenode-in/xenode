"use client";

/**
 * components/sheets-v2/OnlyOfficeSpreadsheetEditor.tsx
 *
 * Orchestrates the browser-only, E2EE Sheets v2 loop:
 *
 *   loadBinary (decrypt)  ->  x2t: xlsx -> Editor.bin  ->  bridge OPEN
 *     -> user edits  ->  bridge SAVE_BYTES (Editor.bin)
 *     -> x2t: Editor.bin -> xlsx  ->  encrypt + saveBinary (revisioned)
 *
 * All plaintext lives in local buffers only; the persistence adapter guarantees
 * the server sees ciphertext. The x2t engine is loaded lazily; if it is
 * unavailable (artifact not built) we surface a clean v1-fallback signal rather
 * than degrading silently.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OnlyOfficeFrame,
  type OnlyOfficeFrameHandle,
} from "./OnlyOfficeFrame";
import { X2tClient } from "@/lib/spreadsheets/v2/conversion/x2tClient";
import { X2tUnavailableError } from "@/lib/spreadsheets/v2/conversion/engine";
import {
  BinaryConflictError,
  type BinaryPersistenceAdapter,
  type LoadedBinaryWorkbook,
} from "@/lib/spreadsheets/v2/types";
import type { SavedDocumentFormat } from "@/lib/spreadsheets/v2/bridge/protocol";

export type SaveState =
  | "loading"
  | "ready"
  | "dirty"
  | "saving"
  | "saved"
  | "conflict"
  | "read_only"
  | "failed";

export interface OnlyOfficeSpreadsheetEditorProps {
  objectId: string;
  adapter: BinaryPersistenceAdapter;
  theme?: "light" | "dark";
  x2t?: X2tClient;
  /** Invoked when v2 cannot proceed and the caller should offer v1 instead. */
  onFallbackToV1?: (reason: string) => void;
  onError?: (code: string, message?: string) => void;
  onLoaded?: (loaded: LoadedBinaryWorkbook) => void;
}

export function OnlyOfficeSpreadsheetEditor({
  objectId,
  adapter,
  theme = "light",
  x2t,
  onFallbackToV1,
  onError,
  onLoaded,
}: OnlyOfficeSpreadsheetEditorProps) {
  const frameRef = useRef<OnlyOfficeFrameHandle | null>(null);
  const loadedRef = useRef<LoadedBinaryWorkbook | null>(null);
  const x2tRef = useRef<X2tClient | null>(null);
  const saveInFlightRef = useRef(false);
  const [state, setState] = useState<SaveState>("loading");
  const [message, setMessage] = useState<string | null>(null);

  // Own the x2t client unless one was injected (tests / shared instance).
  const x2tClient = useMemo(() => x2t ?? new X2tClient(), [x2t]);
  x2tRef.current = x2tClient;

  const fail = useCallback(
    (code: string, msg?: string) => {
      setState("failed");
      setMessage(msg ?? code);
      onError?.(code, msg);
    },
    [onError],
  );

  // ── Initial load + conversion ──────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const loaded = await adapter.loadBinary(objectId, controller.signal);
        if (cancelled) return;
        loadedRef.current = loaded;
        onLoaded?.(loaded);

        let bin: Uint8Array;
        try {
          bin = await x2tClient.toEditorBin(loaded.bytes, loaded.extension);
        } catch (err) {
          if (err instanceof X2tUnavailableError) {
            onFallbackToV1?.("x2t_unavailable");
            return;
          }
          throw err;
        }
        if (cancelled) return;

        // Release the source plaintext bytes now that we hold the Editor.bin.
        loaded.bytes = new Uint8Array(0);

        const frame = frameRef.current;
        if (!frame) return;
        frame.init(loaded.readOnly ? "view" : "edit", theme, loaded.extension);
        // Transfer detaches the buffer; that's fine, we no longer need it.
        frame.openEditorBin(bin.buffer as ArrayBuffer);
        setState(loaded.readOnly ? "read_only" : "ready");
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        const code = err instanceof Error ? err.message : "load_failed";
        fail(code);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectId]);

  // Teardown: dispose the x2t engine we own.
  useEffect(() => {
    return () => {
      if (!x2t) x2tRef.current?.dispose();
    };
  }, [x2t]);

  // ── Bridge handlers ─────────────────────────────────────────────────────────
  const handleSaveBytes = useCallback(
    async (bytes: Uint8Array, format: SavedDocumentFormat, requestId?: string) => {
      const loaded = loadedRef.current;
      if (!loaded || loaded.readOnly || !requestId) {
        if (requestId) frameRef.current?.saveResult(requestId, false);
        return;
      }
      if (saveInFlightRef.current) {
        frameRef.current?.saveResult(requestId, false);
        return;
      }
      saveInFlightRef.current = true;
      setState("saving");
      try {
        const xlsx =
          format === "xlsx"
            ? bytes
            : await x2tClient.fromEditorBinToXlsx(bytes);
        const result = await adapter.saveBinary({ loaded, bytes: xlsx });
        loaded.revision = result.revision;
        frameRef.current?.saveResult(requestId, true);
        setState("saved");
        setMessage(null);
      } catch (err) {
        frameRef.current?.saveResult(requestId, false);
        if (err instanceof BinaryConflictError) {
          setState("conflict");
          setMessage(
            err.latestRevision != null
              ? `A newer revision (${err.latestRevision}) exists.`
              : "A newer revision exists.",
          );
          return;
        }
        fail(err instanceof Error ? err.message : "save_failed");
      } finally {
        saveInFlightRef.current = false;
      }
    },
    [adapter, x2tClient, fail],
  );

  const handlers = useMemo(
    () => ({
      onReady: () => {
        /* frame booted; INIT/OPEN already queued after load */
      },
      onDirtyChanged: (dirty: boolean) =>
        setState((prev) => {
          if (prev === "read_only") return prev;
          if (dirty) return "dirty";
          return prev === "loading" ? "ready" : "saved";
        }),
      onSaveBytes: (bytes: Uint8Array, format: SavedDocumentFormat, requestId?: string) =>
        void handleSaveBytes(bytes, format, requestId),
      onError: (code: string, msg?: string) => {
        if (code === "editor_integration_pending") {
          // Known prototype gap: bridge works, canvas not wired. Do not crash.
          setState((p) => (p === "loading" ? "ready" : p));
          setMessage("Editor canvas integration pending (x2t + sdkjs).");
          onError?.(code, msg);
          return;
        }
        fail(code, msg);
      },
    }),
    [handleSaveBytes, fail, onError],
  );

  const requestSave = useCallback(() => {
    const canRetryFailedSave = state === "failed" && loadedRef.current !== null;
    if (state !== "dirty" && !canRetryFailedSave) return;
    frameRef.current?.requestSave(crypto.randomUUID());
  }, [state]);
  const canSave =
    state === "dirty" ||
    (state === "failed" && loadedRef.current !== null);

  // Ctrl/Cmd+S -> explicit save through the bridge.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        requestSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestSave]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2 text-xs">
        <SaveBadge state={state} message={message} />
        <button
          type="button"
          onClick={requestSave}
          disabled={!canSave}
          className="inline-flex h-7 items-center rounded-md border bg-background px-3 font-medium hover:bg-muted disabled:opacity-50"
        >
          Save
        </button>
      </div>
      <OnlyOfficeFrame
        ref={frameRef}
        handlers={handlers}
        className="block min-h-0 w-full flex-1 border-0"
      />
    </div>
  );
}

function SaveBadge({ state, message }: { state: SaveState; message: string | null }) {
  const label: Record<SaveState, string> = {
    loading: "Loading…",
    ready: "Saved to Xenode",
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved to Xenode",
    conflict: "Conflict",
    read_only: "Read only",
    failed: "Save failed",
  };
  return (
    <span className="text-muted-foreground">
      {label[state]}
      {message ? ` — ${message}` : ""}
    </span>
  );
}
