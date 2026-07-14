import { describe, expect, it, vi } from "vitest";
import {
  isSupportedInputExtension,
  looksLikePackage,
  scratchNames,
} from "@/lib/spreadsheets/v2/conversion/formats";
import { X2tClient } from "@/lib/spreadsheets/v2/conversion/x2tClient";
import type { X2tConversion, X2tEngine } from "@/lib/spreadsheets/v2/conversion/engine";
import {
  assertEditorBinSize,
  assertWorkbookSize,
  MAX_EDITOR_BIN_BYTES,
  MAX_WORKBOOK_BYTES,
  WorkbookLimitError,
} from "@/lib/spreadsheets/v2/limits";

// Minimal ZIP header so `looksLikePackage` accepts the fixture as an xlsx.
const ZIP_XLSX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]);

function fakeEngine(): { engine: X2tEngine; calls: X2tConversion[] } {
  const calls: X2tConversion[] = [];
  const engine: X2tEngine = {
    async convert(request) {
      calls.push(request);
      // Echo a deterministic, output-tagged blob so round-trips are testable.
      const tag = request.outputName.endsWith(".bin") ? 0xbb : 0xaa;
      return new Uint8Array([tag, ...request.input.subarray(0, 4)]);
    },
    dispose: vi.fn(),
  };
  return { engine, calls };
}

describe("v2 conversion formats", () => {
  it("recognizes supported input extensions", () => {
    expect(isSupportedInputExtension("xlsx")).toBe(true);
    expect(isSupportedInputExtension("docx")).toBe(false);
  });

  it("scratch names are document-independent", () => {
    expect(scratchNames("xlsx")).toEqual({
      input: "input.xlsx",
      bin: "Editor.bin",
      output: "output.xlsx",
    });
  });

  it("sniffs ZIP/OLE packages and always allows csv", () => {
    expect(looksLikePackage(ZIP_XLSX, "xlsx")).toBe(true);
    expect(looksLikePackage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "xlsx")).toBe(false);
    expect(looksLikePackage(new Uint8Array([1]), "csv")).toBe(true);
  });
});

describe("v2 limit guards", () => {
  it("rejects oversized workbooks and editor bins", () => {
    expect(() => assertWorkbookSize(MAX_WORKBOOK_BYTES + 1)).toThrow(WorkbookLimitError);
    expect(() => assertEditorBinSize(MAX_EDITOR_BIN_BYTES + 1)).toThrow(WorkbookLimitError);
    expect(() => assertWorkbookSize(10)).not.toThrow();
  });
});

describe("X2tClient", () => {
  it("converts xlsx -> Editor.bin with extension-driven names", async () => {
    const { engine, calls } = fakeEngine();
    const client = new X2tClient({ engineFactory: async () => engine });
    const bin = await client.toEditorBin(ZIP_XLSX, "xlsx");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      inputName: "input.xlsx",
      outputName: "Editor.bin",
    });
    expect(bin[0]).toBe(0xbb);
  });

  it("converts Editor.bin -> xlsx", async () => {
    const { engine, calls } = fakeEngine();
    const client = new X2tClient({ engineFactory: async () => engine });
    const out = await client.fromEditorBinToXlsx(new Uint8Array([9, 9, 9, 9]));
    expect(calls[0]).toMatchObject({
      inputName: "Editor.bin",
      outputName: "output.xlsx",
    });
    expect(out[0]).toBe(0xaa);
  });

  it("rejects unsupported input extensions before touching the engine", async () => {
    const { engine, calls } = fakeEngine();
    const client = new X2tClient({ engineFactory: async () => engine });
    await expect(client.toEditorBin(ZIP_XLSX, "pdf")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("rejects payloads that do not look like a workbook package", async () => {
    const { engine, calls } = fakeEngine();
    const client = new X2tClient({ engineFactory: async () => engine });
    await expect(
      client.toEditorBin(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "xlsx"),
    ).rejects.toThrow(/workbook_not_recognized/);
    expect(calls).toHaveLength(0);
  });

  it("loads the engine at most once across conversions", async () => {
    const { engine } = fakeEngine();
    const factory = vi.fn(async () => engine);
    const client = new X2tClient({ engineFactory: factory });
    await client.toEditorBin(ZIP_XLSX, "xlsx");
    await client.fromEditorBinToXlsx(new Uint8Array([1, 2, 3, 4]));
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
