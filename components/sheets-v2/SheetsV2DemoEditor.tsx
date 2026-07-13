"use client";

/**
 * components/sheets-v2/SheetsV2DemoEditor.tsx
 *
 * Mounts the real Sheets v2 editor at /sheets-v2 against a self-contained demo
 * workbook (no auth/vault needed yet). It drives the SAME pipeline the
 * authenticated flow will use — OnlyOfficeSpreadsheetEditor → x2tClient
 * (browser x2t: xlsx → Editor.bin) → OnlyOfficeFrame bridge → CryptPad's
 * server-less editor — so this is the production editor path exercised with a
 * fixture in place of a decrypted user file.
 *
 * Swapping in the real file is just replacing DemoBinaryPersistenceAdapter with
 * the Xenode binary persistence adapter (which decrypts a StorageObject).
 */

import { useEffect, useMemo, useState } from "react";
import { OnlyOfficeSpreadsheetEditor } from "./OnlyOfficeSpreadsheetEditor";
import type {
  BinaryPersistenceAdapter,
  LoadedBinaryWorkbook,
  SaveBinaryInput,
  SaveBinaryResult,
} from "@/lib/spreadsheets/v2/types";

class DemoBinaryPersistenceAdapter implements BinaryPersistenceAdapter {
  constructor(private readonly bytes: Uint8Array, private readonly dek: CryptoKey) {}
  async loadBinary(objectId: string): Promise<LoadedBinaryWorkbook> {
    return {
      objectId,
      name: "demo.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: "xlsx",
      revision: 0,
      readOnly: false,
      workspace: { type: "personal", workspaceId: "demo" },
      bytes: this.bytes,
      dek: this.dek,
    };
  }
  async saveBinary(input: SaveBinaryInput): Promise<SaveBinaryResult> {
    // Demo: no server round trip. The real adapter encrypts + POSTs here.
    return { revision: input.loaded.revision + 1, savedAt: new Date().toISOString() };
  }
}

async function buildFixtureXlsx(): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Item", "Qty", "Price", "Total"],
    ["Widget", 3, 2.5, 7.5],
    ["Gadget", 5, 4, 20],
    ["Gizmo", 2, 9.99, 19.98],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

type State =
  | { status: "preparing" }
  | { status: "ready"; adapter: BinaryPersistenceAdapter }
  | { status: "error"; message: string };

export function SheetsV2DemoEditor() {
  const [state, setState] = useState<State>({ status: "preparing" });
  const [editorMsg, setEditorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bytes = await buildFixtureXlsx();
        const dek = await crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        );
        if (cancelled) return;
        setState({ status: "ready", adapter: new DemoBinaryPersistenceAdapter(bytes, dek) });
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: e instanceof Error ? e.message : "prepare_failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const theme = useMemo<"light" | "dark">(() => "light", []);

  if (state.status === "preparing") {
    return <div className="p-6 text-sm text-muted-foreground">Preparing demo workbook…</div>;
  }
  if (state.status === "error") {
    return <div className="p-6 text-sm text-red-600">Failed to prepare demo: {state.message}</div>;
  }

  return (
    <div className="flex h-full flex-col">
      {editorMsg && (
        <div className="border-b bg-amber-500/5 px-4 py-2 text-xs text-amber-700">{editorMsg}</div>
      )}
      <div className="min-h-0 flex-1">
        <OnlyOfficeSpreadsheetEditor
          objectId="demo000000000000000000000"
          adapter={state.adapter}
          theme={theme}
          onFallbackToV1={(r) => setEditorMsg(`v2 unavailable (${r}); v1 remains the editor.`)}
          onError={(code, m) => setEditorMsg(`Editor: ${code}${m ? ` — ${m}` : ""}`)}
        />
      </div>
    </div>
  );
}
