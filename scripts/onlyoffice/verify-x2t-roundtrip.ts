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
import JSZip from "jszip";
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
const ARTIFACT = path.join(root, "apps/platform-web/public/internal-editors/onlyoffice", VERSION);
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

type X2tModule = RawX2tModule & {
  onRuntimeInitialized?: () => void;
  calledRun?: boolean;
};
const x2t = require(X2T_JS) as X2tModule;

function makeFixtureXlsx(): Buffer {
  return Buffer.from("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", "base64");
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
    .then(async (outXlsx) => {
      if (outXlsx[0] !== 0x50 || outXlsx[1] !== 0x4b) {
        fail("round-tripped output is not a ZIP/xlsx package");
      }
      console.log(`  → out.xlsx: ${outXlsx.length} bytes`);

      const zip = await JSZip.loadAsync(outXlsx);
      const paths = Object.keys(zip.files).filter((name) =>
        /^xl\/(worksheets\/.*|sharedStrings)\.xml$/i.test(name),
      );
      if (!paths.length) fail("round-tripped workbook has no readable cell XML");
      const cellXml = (
        await Promise.all(paths.map((name) => zip.file(name)!.async("text")))
      ).join("\n");
      for (const expected of EXPECTED_VALUES) {
        const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(
          `<(?:t|v)(?:\\s[^>]*)?>\\s*${escaped}\\s*</(?:t|v)>`,
        );
        if (!pattern.test(cellXml)) {
          fail(`value "${expected}" not preserved through round trip`);
        }
      }
      console.log(`  data preserved: all ${EXPECTED_VALUES.length} expected values survived`);
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
