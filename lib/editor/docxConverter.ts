/**
 * lib/editor/docxConverter.ts
 *
 * Client-side bridge between .docx binaries and BlockNote documents.
 * Every function here runs entirely in the browser — there are ZERO network
 * calls and the DOCX exporter is never invoked on the server.
 *
 *   .docx ArrayBuffer  --mammoth-->  HTML  --tryParseHTMLToBlocks-->  Block[]
 *   Block[]            --DOCXExporter-->  .docx Blob  -->  ArrayBuffer
 */

import mammoth from "mammoth";
import type { Block, BlockNoteEditor } from "@blocknote/core";
import {
  DOCXExporter,
  docxDefaultSchemaMappings,
} from "@blocknote/xl-docx-exporter";

/** A BlockNote editor using whatever schema the caller created it with. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>;

/**
 * Convert an in-memory .docx ArrayBuffer into BlockNote blocks.
 *
 * mammoth turns the .docx into HTML, then the editor's own HTML parser maps
 * that HTML onto its block schema. The `editor` instance is required because
 * parsing is schema-aware.
 */
export async function arrayBufferToBlockNoteBlocks(
  buffer: ArrayBuffer,
  editor: AnyEditor,
): Promise<Block[]> {
  // mammoth picks its browser build automatically in client bundles.
  const { value: html } = await mammoth.convertToHtml(
    { arrayBuffer: buffer },
    {
      // mammoth keeps bold/italic/headings/lists/tables/links by default, but
      // drops underline & strikethrough — preserve them so a loaded document
      // keeps more of its original formatting (BlockNote can represent both).
      styleMap: ["u => u", "strike => s"],
      includeDefaultStyleMap: true,
    },
  );

  // tryParseHTMLToBlocks is schema-aware; awaited so this works whether the
  // installed version returns blocks synchronously or as a promise.
  const blocks = await editor.tryParseHTMLToBlocks(html);
  return blocks as Block[];
}

/**
 * Serialize the current editor document into a .docx file (as an ArrayBuffer).
 *
 * Uses BlockNote's DOCXExporter with the default schema mappings. Runs fully
 * client-side; the returned buffer is what the caller encrypts before upload
 * (for saves) or downloads directly (for the Export button).
 */
export async function blockNoteToDocxBuffer(
  editor: AnyEditor,
): Promise<ArrayBuffer> {
  const exporter = new DOCXExporter(editor.schema, docxDefaultSchemaMappings);
  const blob = await exporter.toBlob(editor.document);
  return blob.arrayBuffer();
}
