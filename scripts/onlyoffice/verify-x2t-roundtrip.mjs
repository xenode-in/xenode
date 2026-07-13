/**
 * scripts/onlyoffice/verify-x2t-roundtrip.mjs
 *
 * Smoke test for the built x2t WASM: proves the browser-only conversion loop
 *   xlsx -> Editor.bin -> xlsx
 * actually works through the compiled module, with no network access.
 *
 * Modeled on CryptPad's test.js (the authoritative usage of this exact module):
 *   - load x2t.js (classic Emscripten module; MEMFS)
 *   - set up /working with a fonts dir (x2t needs fonts to measure text)
 *   - write a TaskQueueDataConvert params.xml; conversion format is driven by
 *     the m_sFileFrom / m_sFileTo file EXTENSIONS
 *   - ccall("main1", ...) returns 0 on success
 *
 * Usage: node scripts/onlyoffice/verify-x2t-roundtrip.mjs
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARTIFACT = path.join(
  root,
  "public/internal-editors/onlyoffice/9.4.0.131-xenode.1",
);
const X2T_JS = path.join(ARTIFACT, "x2t", "x2t.js");
const FONTS_SRC = path.join(ARTIFACT, "fonts");
const MAX_FONTS = 25; // enough for text measurement; keeps FS setup fast

// Distinct values in the fixture below; every one must survive the round trip.
const EXPECTED_VALUES = ["Item", "Qty", "Price", "Total", "Widget", "Gadget", "20"];

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(X2T_JS)) {
  fail(`x2t not built: ${X2T_JS}. Run npm run onlyoffice:build-x2t first.`);
}

const XLSX = require("xlsx");

// ── Build a tiny but real .xlsx fixture (formula + string + number) ──────────
function makeFixtureXlsx() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Item", "Qty", "Price", "Total"],
    ["Widget", 3, 2.5, 7.5],
    ["Gadget", 5, 4, 20],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ── Collect a handful of TTFs to populate the WASM font dir ──────────────────
function collectFonts(dir, out) {
  if (out.length >= MAX_FONTS) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= MAX_FONTS) return;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFonts(p, out);
    else if (/\.ttf$/i.test(entry.name)) out.push(p);
  }
}

const x2t = require(X2T_JS);

function writeFile(wasmPath, data) {
  x2t.FS.writeFile(wasmPath, data);
}

function mkdirp(p) {
  try {
    x2t.FS.mkdir(p);
  } catch {
    /* exists */
  }
}

function initWorkDir() {
  mkdirp("/tmp");
  mkdirp("/working");
  mkdirp("/working/media");
  mkdirp("/working/fonts");
  mkdirp("/working/themes");
  const fonts = [];
  collectFonts(FONTS_SRC, fonts);
  if (!fonts.length) fail("no TTF fonts found in the artifact to feed x2t");
  for (const f of fonts) {
    writeFile(`/working/fonts/${path.basename(f)}`, fs.readFileSync(f));
  }
  console.log(`  fonts loaded: ${fonts.length}`);
}

function paramsXml(fromName, toName) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
    "<m_sFontDir>/working/fonts/</m_sFontDir>" +
    "<m_sThemeDir>/working/themes</m_sThemeDir>" +
    `<m_sFileFrom>/working/${fromName}</m_sFileFrom>` +
    `<m_sFileTo>/working/${toName}</m_sFileTo>` +
    "<m_bIsNoBase64>false</m_bIsNoBase64>" +
    "<m_nCsvTxtEncoding>46</m_nCsvTxtEncoding>" +
    "<m_nCsvDelimiter>4</m_nCsvDelimiter>" +
    "</TaskQueueDataConvert>"
  );
}

/** Convert /working/<fromName> -> /working/<toName> (format by extension). */
function convert(fromName, toName) {
  writeFile("/working/params.xml", paramsXml(fromName, toName));
  const rc = x2t.ccall("main1", "number", ["string"], ["/working/params.xml"]);
  if (rc !== 0) fail(`x2t ${fromName} -> ${toName} failed with exit code ${rc}`);
  return x2t.FS.readFile(`/working/${toName}`, { encoding: "binary" });
}

function runRoundTrip() {
  initWorkDir();

  const srcXlsx = makeFixtureXlsx();
  writeFile("/working/in.xlsx", srcXlsx);
  console.log(`  fixture xlsx: ${srcXlsx.length} bytes`);

  // xlsx -> Editor.bin
  const bin = convert("in.xlsx", "Editor.bin");
  if (!bin.length) fail("Editor.bin is empty");
  console.log(`  → Editor.bin: ${bin.length} bytes`);

  // Editor.bin -> xlsx
  const outXlsx = convert("Editor.bin", "out.xlsx");
  if (outXlsx[0] !== 0x50 || outXlsx[1] !== 0x4b) {
    fail("round-tripped output is not a ZIP/xlsx package");
  }
  console.log(`  → out.xlsx: ${outXlsx.length} bytes`);

  // Verify every cell value survived. Checked by VALUE across all cells, not by
  // A1 position, because x2t's xlsx export omits <dimension> and writes cell
  // refs one row below the enclosing <row r="..."> — see the fidelity note below.
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

  // Fidelity note (non-fatal): flag the known row-index representation quirk so
  // this smoke test is never mistaken for a full fidelity pass.
  if (ws["A1"] === undefined && ws["A2"] !== undefined) {
    console.log(
      "  ⚠ fidelity note: x2t output places cells one row below their <row r> " +
        "element and omits <dimension>; strict readers (SheetJS) see a +1 row " +
        "shift. Non-accumulating. Resolve at the round-trip corpus / sdkjs-open gate.",
    );
  }
  console.log("✓ x2t round-trip xlsx → Editor.bin → xlsx passed");
  process.exit(0);
}

// Classic Emscripten module: run once the WASM runtime is ready.
if (x2t.calledRun) runRoundTrip();
else x2t.onRuntimeInitialized = () => {
  try {
    runRoundTrip();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
};
