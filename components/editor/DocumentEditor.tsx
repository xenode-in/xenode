"use client";

// BlockNote styles. Imported here (a client component that is itself loaded via
// dynamic(ssr:false) by the host page) so BlockNote never touches the server.
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { AlertTriangle, Download, FileWarning, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { decryptDocument, encryptDocument } from "@/lib/crypto/documentCrypto";
import {
  arrayBufferToBlockNoteBlocks,
  blockNoteToDocxBuffer,
} from "@/lib/editor/docxConverter";
import { SaveStatus, type SaveState } from "./SaveStatus";
import { EditorToolbar } from "./EditorToolbar";

// ─────────────────────────────────────────────────────────────────────────────
// COLLABORATION SCAFFOLD
// When real-time collaboration is needed, integrate Yjs here.
// BlockNote has first-class Yjs support via useCreateBlockNote({
//   collaboration: { provider, fragment, user } })
// Encrypt Yjs update messages before sending over the wire —
// never send plaintext diffs to the server.
// Suggested packages when ready: yjs, @hocuspocus/provider
// ─────────────────────────────────────────────────────────────────────────────

const AUTOSAVE_INTERVAL_MS = 30_000;
const MAX_SAVE_RETRIES = 3; // after this many failed retries, prompt manual export

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type LoadPhase = "loading" | "ready" | "decrypt-error" | "convert-error";

interface DocumentEditorProps {
  /** Encrypted document blob in [iv(12) | ciphertext] form. */
  encryptedBlob: ArrayBuffer;
  /** AES-GCM key used to decrypt on load and encrypt on save. */
  cryptoKey: CryptoKey;
  /** Persists the freshly-encrypted blob. Only ciphertext ever leaves here. */
  onSave: (encryptedBlob: ArrayBuffer) => Promise<void>;
  /** Display name, used for download filenames. */
  fileName?: string;
}

/** Resolve the BlockNote color scheme from the app's active theme class. */
function useAppColorScheme(): "light" | "dark" {
  const [scheme, setScheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const DARK_THEMES = ["dark", "imperial", "deep-navy", "xenode-green", "force-dark"];
    const compute = () => {
      const classes = document.documentElement.classList;
      setScheme(DARK_THEMES.some((c) => classes.contains(c)) ? "dark" : "light");
    };
    compute();
    const observer = new MutationObserver(compute);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return scheme;
}

function downloadBytes(data: ArrayBuffer, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function baseName(name: string) {
  return name.replace(/\.[^./\\]+$/, "") || "document";
}

export default function DocumentEditor({
  encryptedBlob,
  cryptoKey,
  onSave,
  fileName = "document",
}: DocumentEditorProps) {
  const editor = useCreateBlockNote();
  const colorScheme = useAppColorScheme();

  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Decrypted plaintext .docx, held only in memory for the convert-error
  // download fallback. Never persisted to any storage.
  const decryptedDocxRef = useRef<ArrayBuffer | null>(null);
  // Marks the editor as loaded so the initial content load doesn't count as a
  // user edit. Also used to gate auto-save.
  const readyRef = useRef(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);

  // ── Load: decrypt → mammoth → parse → populate editor ──────────────────────
  useEffect(() => {
    let cancelled = false;
    readyRef.current = false;

    (async () => {
      setPhase("loading");

      // 1. Decrypt in memory. Failures are surfaced, never swallowed, and we
      //    never render partial content.
      let plaintext: ArrayBuffer;
      try {
        plaintext = await decryptDocument(encryptedBlob, cryptoKey);
      } catch {
        if (!cancelled) setPhase("decrypt-error");
        return;
      }
      decryptedDocxRef.current = plaintext;

      // 2. Convert .docx → HTML → blocks.
      let blocks;
      try {
        blocks = await arrayBufferToBlockNoteBlocks(plaintext, editor);
      } catch {
        if (!cancelled) setPhase("convert-error");
        return;
      }
      if (cancelled) return;

      // 3. Load into the editor. If parsing yielded nothing, fall back to the
      //    default empty editor with a warning rather than erroring out.
      try {
        if (blocks.length > 0) {
          editor.replaceBlocks(editor.document, blocks);
        } else {
          toast.warning(
            "Couldn't read the document's formatting. Starting from an empty editor.",
          );
        }
      } catch {
        toast.warning(
          "Couldn't load the document contents. Starting from an empty editor.",
        );
      }

      if (cancelled) return;
      readyRef.current = true;
      setPhase("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [encryptedBlob, cryptoKey, editor]);

  // ── Track edits (only after the initial load completes) ────────────────────
  useEffect(() => {
    const unsubscribe = editor.onChange(() => {
      if (readyRef.current) dirtyRef.current = true;
    });
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [editor]);

  // ── Save (with exponential backoff retry) ──────────────────────────────────
  const save = useCallback(async () => {
    if (savingRef.current || !readyRef.current) return;

    savingRef.current = true;
    setSaveState("saving");

    let failures = 0;
    for (;;) {
      try {
        const docxBuffer = await blockNoteToDocxBuffer(editor);
        const encrypted = await encryptDocument(docxBuffer, cryptoKey);
        await onSave(encrypted);

        dirtyRef.current = false;
        setLastSavedAt(Date.now());
        setSaveState("saved");
        savingRef.current = false;
        return;
      } catch {
        failures += 1;
        if (failures > MAX_SAVE_RETRIES) {
          setSaveState("error");
          savingRef.current = false;
          toast.error(
            "Couldn't save after several attempts. Use the Export button to download a local copy so your work isn't lost.",
          );
          return;
        }
        // Backoff: 1s, 2s, 4s.
        const delay = 1000 * 2 ** (failures - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }, [editor, cryptoKey, onSave]);

  // ── Auto-save every 30s when there are unsaved changes ─────────────────────
  useEffect(() => {
    if (phase !== "ready") return;
    const id = setInterval(() => {
      if (dirtyRef.current && !savingRef.current) void save();
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [phase, save]);

  // ── Ctrl/Cmd+S → immediate save ────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "ready") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, save]);

  // ── Error states ───────────────────────────────────────────────────────────
  if (phase === "decrypt-error") {
    return (
      <ErrorState
        icon={<AlertTriangle className="h-7 w-7 text-destructive" />}
        title="Couldn't decrypt this document"
        message="The encryption key may be incorrect, or the file may be corrupted. Your data is safe — nothing was changed."
        actionLabel="Download raw encrypted file"
        onAction={() =>
          downloadBytes(
            encryptedBlob,
            `${baseName(fileName)}.docx.enc`,
            "application/octet-stream",
          )
        }
      />
    );
  }

  if (phase === "convert-error") {
    return (
      <ErrorState
        icon={<FileWarning className="h-7 w-7 text-destructive" />}
        title="Couldn't open this document for editing"
        message="The file was decrypted successfully but couldn't be converted for the editor. You can download the original .docx and open it in another app."
        actionLabel="Download original .docx"
        onAction={() => {
          if (decryptedDocxRef.current) {
            downloadBytes(
              decryptedDocxRef.current,
              `${baseName(fileName)}.docx`,
              DOCX_MIME,
            );
          }
        }}
      />
    );
  }

  // ── Editor ──────────────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full w-full flex-col bg-muted/60">
      {/* Persistent, always-visible formatting toolbar (Google-Docs style),
          with the save-status pill + Export pinned to its right edge. */}
      <EditorToolbar
        editor={editor}
        fileName={fileName}
        statusSlot={
          <SaveStatus
            status={saveState}
            lastSavedAt={lastSavedAt}
            onRetry={() => void save()}
          />
        }
      />

      {/* Canvas with a centered document "page". The built-in slash menu and
          drag handles stay enabled; only the floating toolbar is replaced. */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto my-4 min-h-[70vh] w-full max-w-[816px] rounded-sm border bg-card px-2 py-12 shadow-md sm:my-8 sm:min-h-[1056px] sm:px-10 sm:py-20">
          <BlockNoteView
            editor={editor}
            theme={colorScheme}
            editable
            formattingToolbar={false}
            className="xenode-doc-blocknote"
          />
        </div>
      </div>

      {/* Loading overlay — keeps the editor mounted underneath while content loads. */}
      {phase === "loading" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-background/90 backdrop-blur-sm">
          <Loader2 className="h-9 w-9 animate-spin text-primary" />
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">Opening document</p>
            <p className="text-xs text-muted-foreground">
              Decrypting locally — your data never leaves this device unencrypted.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        {icon}
      </div>
      <div className="max-w-md space-y-1.5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      <Button variant="outline" onClick={onAction} className="mt-1 gap-2">
        <Download className="h-4 w-4" />
        {actionLabel}
      </Button>
    </div>
  );
}
