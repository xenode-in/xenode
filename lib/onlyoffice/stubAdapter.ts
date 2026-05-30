/**
 * lib/onlyoffice/stubAdapter.ts
 *
 * A no-engine stand-in for {@link OnlyOfficeAdapter}. It lets the whole editor
 * shell — toolbar, save-status machine, the E2EE decrypt→edit→encrypt→upload
 * roundtrip — be built and exercised *before* the multi-MB AGPL ONLYOFFICE
 * build is vendored under `public/onlyoffice/` (see `x2tLoader.ts`).
 *
 * Contract it deliberately upholds:
 *   - `save()` returns the *original* plaintext bytes unchanged, so the real
 *     encrypt-with-fresh-IV + upload path is fully testable end-to-end.
 *   - Mutating toolbar commands fire `onDirty`, so the debounced auto-save
 *     state machine can be driven without a real editor.
 *   - It renders only a static placeholder into the iframe (`srcdoc`); it never
 *     parses or paints the decrypted document, and never copies the plaintext
 *     anywhere outside the in-memory closure below.
 *   - `exportAs("pdf")` (and any cross-format export) rejects with a friendly
 *     message — real conversion needs the x2t WASM.
 *
 * SECURITY: the decrypted bytes live only in the `plaintext` closure variable
 * and are dropped on `destroy()`. They are never logged, serialized, or written
 * to storage.
 */

import {
  type DocFormat,
  type OnlyOfficeAdapter,
  type OnlyOfficeAdapterInit,
} from "./adapter";

function placeholderHtml(format: DocFormat, editable: boolean): string {
  const mode = editable ? "Editable" : "Read-only";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid;
    place-items: center;
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #6b7280;
    background: #ffffff;
    padding: 24px;
    box-sizing: border-box;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #9ca3af; background: #0a0a0a; }
    .card { border-color: #27272a !important; }
    .badge { background: #18181b !important; border-color: #27272a !important; }
  }
  .card {
    max-width: 420px;
    text-align: center;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 32px 28px;
  }
  .title { font-weight: 600; color: inherit; margin: 0 0 8px; font-size: 15px; }
  .sub { margin: 0; }
  .badges { margin-top: 16px; display: flex; gap: 8px; justify-content: center; }
  .badge {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 999px;
    background: #f4f4f5;
    border: 1px solid #e5e7eb;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
</style>
</head>
<body>
  <div class="card">
    <p class="title">Editor preview (engine not vendored)</p>
    <p class="sub">The document was decrypted in your browser and is ready. The
    ONLYOFFICE x2t engine isn't installed yet, so this is a stub surface.</p>
    <div class="badges">
      <span class="badge">${format}</span>
      <span class="badge">${mode}</span>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Build a stub adapter. Mirrors the async signature of the real
 * {@link CreateAdapter} so the factory in `index.ts` can swap between them.
 */
export async function createStubAdapter(
  init: OnlyOfficeAdapterInit,
): Promise<OnlyOfficeAdapter> {
  // Plaintext bytes, in-memory only. Dropped on destroy().
  let plaintext: ArrayBuffer | null = init.document;
  let destroyed = false;

  // Render the static placeholder. `srcdoc` keeps it same-origin with no fetch.
  init.container.srcdoc = placeholderHtml(init.format, init.editable);

  const markDirty = () => {
    if (!destroyed && init.editable) init.onDirty();
  };

  // Signal "ready" on the next tick so callers can attach listeners first.
  queueMicrotask(() => {
    if (!destroyed) init.onReady();
  });

  return {
    exec: markDirty,
    setFontFamily: markDirty,
    setFontSize: markDirty,
    setHeading: markDirty,
    insertTable: markDirty,
    insertImage: markDirty,

    async save(): Promise<ArrayBuffer> {
      if (!plaintext) {
        throw new Error("Editor was destroyed; nothing to save.");
      }
      // Return a copy so callers can transfer/encrypt without mutating ours.
      return plaintext.slice(0);
    },

    async exportAs(format: DocFormat): Promise<ArrayBuffer> {
      if (!plaintext) {
        throw new Error("Editor was destroyed; nothing to export.");
      }
      if (format === init.format) return plaintext.slice(0);
      throw new Error(
        `Exporting to ${format.toUpperCase()} requires the ONLYOFFICE x2t engine, ` +
          "which isn't vendored yet.",
      );
    },

    destroy(): void {
      destroyed = true;
      plaintext = null;
      try {
        init.container.removeAttribute("srcdoc");
      } catch {
        // container may already be detached — nothing to clean up.
      }
    },
  };
}
