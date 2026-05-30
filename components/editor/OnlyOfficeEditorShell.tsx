"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { useCrypto } from "@/contexts/CryptoContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  createOnlyOfficeAdapter,
  isStubMode,
} from "@/lib/onlyoffice";
import {
  contentTypeForFormat,
  DocumentDecryptError,
  EngineNotVendoredError,
  type DocFormat,
  type OnlyOfficeAdapter,
} from "@/lib/onlyoffice/adapter";
import { loadEncryptedDocument } from "@/lib/onlyoffice/documentCrypto";
import { useAutoSave } from "@/hooks/useAutoSave";
import { EditorIframe } from "./EditorIframe";
import { EditorToolbar } from "./EditorToolbar";
import { SaveStatusIndicator } from "./SaveStatusIndicator";
import { EditorErrorState } from "./EditorErrorState";
import type { EditorError } from "./types";

type Phase = "init" | "locked" | "loading" | "ready" | "error";

interface LoadedRef {
  document: ArrayBuffer;
  format: DocFormat;
  fileName: string | null;
}

/** Trigger a browser download of in-memory bytes (user's own decrypted file). */
function downloadBytes(bytes: ArrayBuffer, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function classifyError(err: unknown): EditorError {
  if (err instanceof EngineNotVendoredError) {
    return { kind: "engine", message: err.message };
  }
  if (err instanceof DocumentDecryptError) {
    return { kind: "decrypt", message: err.message };
  }
  if (err instanceof Error) {
    if (/can't be opened|single-blob document/i.test(err.message)) {
      return { kind: "unsupported", message: err.message };
    }
    return { kind: "generic", message: err.message };
  }
  return { kind: "generic", message: "Couldn't open this document." };
}

export function OnlyOfficeEditorShell({ fileId }: { fileId: string }) {
  const router = useRouter();
  const { privateKey, metadataKey, isUnlocked, isInitializing, setModalOpen } =
    useCrypto();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const adapterRef = useRef<OnlyOfficeAdapter | null>(null);
  const dekRef = useRef<CryptoKey | null>(null);
  const loadedRef = useRef<LoadedRef | null>(null);

  const [loadPhase, setLoadPhase] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [adapter, setAdapter] = useState<OnlyOfficeAdapter | null>(null);
  const [docInfo, setDocInfo] = useState<{
    format: DocFormat;
    editable: boolean;
    fileName: string | null;
  } | null>(null);
  const [baselineUpdatedAt, setBaselineUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<EditorError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Mirror of loadedRef for render: true once decrypted bytes are in hand, so
  // the error state can offer a download without reading a ref during render.
  const [canDownloadDecrypted, setCanDownloadDecrypted] = useState(false);

  // The init/locked gate is derived from crypto context during render; only the
  // async load lifecycle (loading/ready/error) is held in state. Keeping the
  // gate out of the load effect means no synchronous setState fires there.
  const gate: Phase | null = isInitializing
    ? "init"
    : !isUnlocked || !privateKey
      ? "locked"
      : null;
  const phase: Phase = gate ?? loadPhase;

  const autoSave = useAutoSave({
    fileId,
    getAdapter: () => adapterRef.current,
    getDek: () => dekRef.current,
    baselineUpdatedAt,
    enabled: phase === "ready" && (docInfo?.editable ?? false),
  });
  // Keep a live handle so the adapter's onDirty (a stale closure) hits the
  // latest hook instance. Synced post-commit (not during render) so onDirty —
  // which only fires after mount — always sees the current instance.
  const autoSaveRef = useRef(autoSave);
  useEffect(() => {
    autoSaveRef.current = autoSave;
  });

  // ── Load → decrypt → mount engine ──────────────────────────────────────────
  useEffect(() => {
    if (isInitializing) return;
    if (!isUnlocked || !privateKey) {
      setModalOpen(true);
      return;
    }
    const iframe = iframeRef.current;
    if (!iframe) return;

    const controller = new AbortController();
    let cancelled = false;
    let localAdapter: OnlyOfficeAdapter | null = null;

    (async () => {
      try {
        setError(null);
        setLoadPhase("loading");

        const loaded = await loadEncryptedDocument({
          fileId,
          privateKey,
          metadataKey,
          signal: controller.signal,
        });
        if (cancelled) return;

        dekRef.current = loaded.dek;
        loadedRef.current = {
          document: loaded.document,
          format: loaded.format,
          fileName: loaded.fileName,
        };
        setCanDownloadDecrypted(true);
        setBaselineUpdatedAt(loaded.baselineUpdatedAt);
        setDocInfo({
          format: loaded.format,
          editable: loaded.editable,
          fileName: loaded.fileName,
        });

        localAdapter = await createOnlyOfficeAdapter(
          {
            container: iframe,
            document: loaded.document,
            format: loaded.format,
            editable: loaded.editable,
            onReady: () => {
              if (!cancelled) setLoadPhase("ready");
            },
            onDirty: () => autoSaveRef.current.notifyDirty(),
            onError: (engineErr) => {
              if (cancelled) return;
              setError({ kind: "parse", message: engineErr.message });
              setLoadPhase("error");
            },
          },
          { signal: controller.signal },
        );
        if (cancelled) {
          localAdapter.destroy();
          return;
        }
        adapterRef.current = localAdapter;
        setAdapter(localAdapter);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(classifyError(err));
        setLoadPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      localAdapter?.destroy();
      adapterRef.current = null;
      dekRef.current = null;
      loadedRef.current = null;
      setAdapter(null);
      setCanDownloadDecrypted(false);
    };
  }, [fileId, isInitializing, isUnlocked, privateKey, metadataKey, setModalOpen, reloadKey]);

  // ── Ctrl/Cmd+S manual save ──────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (phase === "ready" && docInfo?.editable) {
          void autoSaveRef.current.saveNow();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, docInfo?.editable]);

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  const handleExport = useCallback(async (target: DocFormat) => {
    const a = adapterRef.current;
    const loaded = loadedRef.current;
    if (!a || !loaded) return;
    try {
      const bytes =
        target === loaded.format ? await a.save() : await a.exportAs(target);
      const base = loaded.fileName?.replace(/\.[^.]+$/, "") || "document";
      downloadBytes(bytes, `${base}.${target}`, contentTypeForFormat(target));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    }
  }, []);

  const handleDownloadDecrypted = useCallback(() => {
    const loaded = loadedRef.current;
    if (!loaded) return;
    const base = loaded.fileName?.replace(/\.[^.]+$/, "") || "document";
    downloadBytes(
      loaded.document,
      `${base}.${loaded.format}`,
      contentTypeForFormat(loaded.format),
    );
  }, []);

  const title = docInfo?.fileName || "Document";

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => router.push("/dashboard")}
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="truncate text-sm font-medium text-foreground">
          {title}
        </span>
        {isStubMode() && (
          <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
            Stub
          </span>
        )}
      </header>

      {/* Toolbar — only the stub needs Xenode's custom chrome. The real engine
          renders ONLYOFFICE's own native ribbon inside the iframe, so we don't
          stack a second toolbar on top of it. */}
      {phase === "ready" && isStubMode() && adapter && docInfo && (
        <EditorToolbar
          adapter={adapter}
          format={docInfo.format}
          editable={docInfo.editable}
          saving={autoSave.status === "saving"}
          onSave={() => void autoSave.saveNow()}
          onExport={(f) => void handleExport(f)}
        />
      )}

      {/* Editor surface */}
      <main className="relative flex-1 overflow-hidden">
        <EditorIframe
          ref={iframeRef}
          className={cn(
            "h-full w-full border-0",
            phase !== "ready" && "invisible",
          )}
        />

        {phase === "ready" && docInfo?.editable && (
          <SaveStatusIndicator
            status={autoSave.status}
            onRetry={() => void autoSave.saveNow()}
            className="absolute bottom-4 right-4"
          />
        )}

        {phase === "init" && <CenteredSpinner label="Preparing your vault…" />}
        {phase === "loading" && (
          <CenteredSpinner label="Decrypting document…" />
        )}
        {phase === "locked" && (
          <LockedState onUnlock={() => setModalOpen(true)} />
        )}
        {phase === "error" && error && (
          <EditorErrorState
            error={error}
            onRetry={reload}
            onClose={() => router.push("/dashboard")}
            onDownloadDecrypted={
              canDownloadDecrypted ? handleDownloadDecrypted : undefined
            }
          />
        )}
      </main>
    </div>
  );
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">{label}</p>
      </div>
    </div>
  );
}

function LockedState({ onUnlock }: { onUnlock: () => void }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-background">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-border bg-muted">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">
            Unlock your vault to edit
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            This document is end-to-end encrypted. Unlock your vault to decrypt
            and edit it in your browser.
          </p>
        </div>
        <Button onClick={onUnlock}>Unlock vault</Button>
      </div>
    </div>
  );
}
