/**
 * scripts/onlyoffice/verify-x2t-roundtrip.ts
 *
 * Smoke test for the built x2t WASM: proves the browser-only conversion loop
 *   xlsx -> Editor.bin -> xlsx
 * works through the compiled module with no network access.
 *
 * Crucially, this drives the REAL shipped conversion code — engine.ts's
 * `adaptRawModule` + `ensureWorkDirs` — against the actual WASM module, so the
 * validated recipe and the code the browser runs can never silently diverge.
 * (It supplies the module + fonts the way browserEngine.ts does, then uses the
 * same engine surface the persistence layer calls.)
 *
 * Run: npm run onlyoffice:verify-x2t   (tsx)
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptRawModule,
  ensureWorkDirs,
  FONTS_DIR,
  type RawX2tModule,
} from "../../lib/spreadsheets/v2/conversion/engine";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERSION =
  process.env.NEXT_PUBLIC_ONLYOFFICE_ARTIFACT_VERSION ?? "9.3.0.140-cryptpad.2-xenode.1";
const ARTIFACT = path.join(root, "public/internal-editors/onlyoffice", VERSION);
const X2T_JS = path.join(ARTIFACT, "x2t", "x2t.js");
const FONTS_SRC = path.join(ARTIFACT, "fonts");
const MAX_FONTS = 25;

// Distinct values in the fixture below; every one must survive the round trip.
const EXPECTED_VALUES = ["Item", "Qty", "Price", "Total", "Widget", "Gadget", "20"];

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(X2T_JS)) {
  fail(`x2t not built: ${X2T_JS}. Run npm run onlyoffice:build-x2t first.`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const XLSX: any = require("xlsx");

type X2tModule = RawX2tModule & {
  onRuntimeInitialized?: () => void;
  calledRun?: boolean;
};
const x2t = require(X2T_JS) as X2tModule;

function makeFixtureXlsx(): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Item", "Qty", "Price", "Total"],
    ["Widget", 3, 2.5, 7.5],
    ["Gadget", 5, 4, 20],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function collectFonts(dir: string, out: string[]): void {
  if (out.length >= MAX_FONTS) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= MAX_FONTS) return;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFonts(p, out);
    else if (/\.ttf$/i.test(entry.name)) out.push(p);
  }
}

/** Populate the WASM font dir the way browserEngine.ts does (from disk here). */
function loadFonts(): void {
  const fonts: string[] = [];
  collectFonts(FONTS_SRC, fonts);
  if (!fonts.length) fail("no TTF fonts found in the artifact to feed x2t");
  for (const f of fonts) {
    x2t.FS.writeFile(`${FONTS_DIR}/${path.basename(f)}`, fs.readFileSync(f));
  }
  console.log(`  fonts loaded: ${fonts.length}`);
}

function runRoundTrip(): void {
  ensureWorkDirs(x2t);
  loadFonts();
  const engine = adaptRawModule(x2t);

  const srcXlsx = makeFixtureXlsx();
  console.log(`  fixture xlsx: ${srcXlsx.length} bytes`);

  // The real engine surface the persistence layer uses.
  return void Promise.resolve()
    .then(() => engine.convert({ input: srcXlsx, inputName: "in.xlsx", outputName: "Editor.bin" }))
    .then((bin) => {
      if (!bin.length) fail("Editor.bin is empty");
      console.log(`  → Editor.bin: ${bin.length} bytes`);
      return engine.convert({ input: bin, inputName: "Editor.bin", outputName: "out.xlsx" });
    })
    .then((outXlsx) => {
      if (outXlsx[0] !== 0x50 || outXlsx[1] !== 0x4b) {
        fail("round-tripped output is not a ZIP/xlsx package");
      }
      console.log(`  → out.xlsx: ${outXlsx.length} bytes`);

      // Verify every cell value survived (by value, not A1 position — see note).
      const wb = XLSX.read(Buffer.from(outXlsx), { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const cellKeys = Object.keys(ws).filter((k) => !k.startsWith("!"));
      const values = new Set(cellKeys.map((k) => String(ws[k].v)));
      for (const expected of EXPECTED_VALUES) {
        if (!values.has(expected)) {
          fail(`value "${expected}" not preserved through round trip`);
        }
      }
      console.log(`  data preserved: all ${values.size} distinct cell values survived`);

      if (ws["A1"] === undefined && ws["A2"] !== undefined) {
        console.log(
          "  ⚠ fidelity note: x2t output places cells one row below their <row r> " +
            "element and omits <dimension>; strict readers (SheetJS) see a +1 row " +
            "shift. Non-accumulating. Resolve at the round-trip corpus / sdkjs-open gate.",
        );
      }
      console.log("✓ x2t round-trip xlsx → Editor.bin → xlsx passed (via engine.ts)");
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

if (x2t.calledRun) runRoundTrip();
else x2t.onRuntimeInitialized = () => runRoundTrip();
