/**
 * scripts/vendor-onlyoffice.mjs
 *
 * Vendors the ONLYOFFICE offline editor (sdkjs + web-apps + fonts) and the x2t
 * WASM converter into `public/onlyoffice/`, so Xenode's client-side, E2EE
 * document editor can run with NO Document Server — everything stays same-origin
 * under the locked-down CSP and plaintext never leaves the browser.
 *
 * Both artifacts are PINNED CryptPad release zips, verified by sha512 (the exact
 * versions + checksums CryptPad ships; see their install-onlyoffice.sh):
 *   - editor: cryptpad/onlyoffice-editor  @ v9.2.0.119+5  (ONLYOFFICE 9.2)
 *   - x2t:    cryptpad/onlyoffice-x2t-wasm @ v7.3+1
 *
 * LICENSE: these assets are AGPL-3.0 (ONLYOFFICE + CryptPad's offline build).
 * They are gitignored and fetched at build time rather than committed. Running
 * this script writes a THIRD-PARTY-NOTICE recording the source-offer obligation.
 *
 * Cross-platform (Windows / macOS / Linux) with ZERO runtime dependencies:
 *   - download  → global fetch (follows redirects), streamed to disk
 *   - integrity → node:crypto sha512, streamed
 *   - extraction→ a minimal central-directory ZIP reader below (no system
 *                 `unzip`/`tar` needed; GNU tar can't read zips and Docker base
 *                 images often lack `unzip`).
 *
 * Usage:
 *   npm run vendor:onlyoffice                 # fetch if not already present
 *   npm run vendor:onlyoffice -- --force      # re-fetch even if present
 *   npm run vendor:onlyoffice -- --only=x2t   # just x2t (or --only=editor)
 *   npm run vendor:onlyoffice -- --keep-help  # don't prune the help/ dirs
 *   npm run vendor:onlyoffice -- --only=editor --from-file=./onlyoffice-editor.zip
 *                                             # verify + extract a locally-downloaded
 *                                             # zip instead of fetching (for slow links)
 */

import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  createReadStream,
  createWriteStream,
  mkdtempSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const OUT = join(ROOT, "public", "onlyoffice");
const MARKER = join(OUT, ".vendored.json");

const ARTIFACTS = {
  editor: {
    label: "ONLYOFFICE editor (sdkjs + web-apps)",
    version: "v9.2.0.119+5",
    url: "https://github.com/cryptpad/onlyoffice-editor/releases/download/v9.2.0.119+5/onlyoffice-editor.zip",
    sha512:
      "1f1184fb04cf72a7eb2a49a9740074b5419486c79e1fd713e1f8c09b8594a826050ae941fed6ac6a96807ba73cc751d7c807bd7e6b73de9e4f8e74cd5ed04cfa",
    dest: OUT,
    // Must exist after extraction — guards against an unexpected zip layout.
    expect: ["web-apps/apps/api/documents/api.js", "sdkjs"],
  },
  x2t: {
    label: "x2t WASM converter",
    version: "v7.3+1",
    url: "https://github.com/cryptpad/onlyoffice-x2t-wasm/releases/download/v7.3+1/x2t.zip",
    sha512:
      "ab0c05b0e4c81071acea83f0c6a8e75f5870c360ec4abc4af09105dd9b52264af9711ec0b7020e87095193ac9b6e20305e446f2321a541f743626a598e5318c1",
    dest: join(OUT, "x2t"),
    expect: [],
  },
};

// ── tiny arg parser ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const KEEP_HELP = args.includes("--keep-help");
const onlyArg = args.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice("--only=".length) : null;
const fromFileArg = args.find((a) => a.startsWith("--from-file="));
const FROM_FILE = fromFileArg
  ? resolve(fromFileArg.slice("--from-file=".length))
  : null;

function log(msg) {
  process.stdout.write(`[vendor:onlyoffice] ${msg}\n`);
}

// ── download → temp file (streamed, follows GitHub's redirect to the CDN) ──────
async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`download failed: ${res.status} ${res.statusText} — ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function sha512Of(file) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

// ── minimal ZIP extractor ─────────────────────────────────────────────────────
// Reads the central directory (authoritative for sizes/offsets/method, which
// sidesteps streaming data-descriptor quirks). Supports stored (0) + deflate
// (8). Refuses encrypted/zip64 with a clear message rather than corrupting data.
function locateEOCD(buf) {
  const SIG = 0x06054b50;
  const min = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG) {
      const entries = buf.readUInt16LE(i + 10);
      const cdOffset = buf.readUInt32LE(i + 16);
      if (entries === 0xffff || cdOffset === 0xffffffff) {
        throw new Error("zip64 archives are not supported by this extractor.");
      }
      return { entries, cdOffset };
    }
  }
  throw new Error("End-of-central-directory not found (corrupt or not a zip).");
}

// Top-level path segments a zip will create — lets us clean exactly what an
// artifact owns, so re-vendoring the editor never deletes a sibling (x2t/) or
// the committed glue files (engine.js / editor.html / manifest.json).
function zipTopLevelNames(buf) {
  const { entries, cdOffset } = locateEOCD(buf);
  const names = new Set();
  let off = cdOffset;
  for (let i = 0; i < entries; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) {
      throw new Error("bad central-directory header signature.");
    }
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    const top = name.split("/")[0];
    if (top) names.add(top);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function extractZip(buf, destDir) {
  const { entries, cdOffset } = locateEOCD(buf);
  const base = resolve(destDir);
  let off = cdOffset;
  let count = 0;

  for (let i = 0; i < entries; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) {
      throw new Error("bad central-directory header signature.");
    }
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);

    if (flags & 0x1) throw new Error(`encrypted entry not supported: ${name}`);
    if (compSize === 0xffffffff || localOff === 0xffffffff) {
      throw new Error(`zip64 entry not supported: ${name}`);
    }

    const outPath = resolve(base, name);
    // Path-traversal guard: every entry must stay under destDir.
    if (outPath !== base && !outPath.startsWith(base + sep)) {
      throw new Error(`unsafe zip entry path: ${name}`);
    }

    if (name.endsWith("/")) {
      mkdirSync(outPath, { recursive: true });
    } else {
      // Local header may carry different extra-field length than the central
      // record — read it to find where the entry's data actually starts.
      if (buf.readUInt32LE(localOff) !== 0x04034b50) {
        throw new Error(`bad local header for ${name}`);
      }
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);

      let data;
      if (method === 0) data = comp;
      else if (method === 8) data = inflateRawSync(comp);
      else throw new Error(`unsupported compression method ${method}: ${name}`);

      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, data);
      count++;
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return count;
}

// ── per-artifact vendoring ─────────────────────────────────────────────────────
async function vendor(key, art, tmp, localZip) {
  log(`${art.label} — ${art.version}`);

  let zip;
  if (localZip) {
    if (!existsSync(localZip)) {
      throw new Error(`--from-file not found: ${localZip}`);
    }
    zip = localZip;
    log(`  using local file ${localZip}`);
  } else {
    zip = join(tmp, `${key}.zip`);
    log(`  downloading ${art.url}`);
    await download(art.url, zip);
  }

  log(`  verifying sha512`);
  const actual = await sha512Of(zip);
  if (actual !== art.sha512) {
    throw new Error(
      `checksum mismatch for ${key}.zip\n  expected ${art.sha512}\n  actual   ${actual}` +
        (localZip
          ? `\n  The --from-file you supplied doesn't match the pinned ${art.version} release.\n  Re-download from: ${art.url}`
          : ""),
    );
  }

  log(`  extracting → ${art.dest.replace(ROOT + sep, "")}`);
  const buf = readFileSync(zip);
  // Clean only the top-level entries THIS zip will write — never the whole dest.
  // dest is the shared /public/onlyoffice root for the editor, so a blanket wipe
  // would clobber x2t/ and the committed engine.js/editor.html/manifest.json.
  mkdirSync(art.dest, { recursive: true });
  for (const top of zipTopLevelNames(buf)) {
    rmSync(join(art.dest, top), { recursive: true, force: true });
  }
  const files = extractZip(buf, art.dest);
  log(`  extracted ${files} files`);

  for (const rel of art.expect) {
    if (!existsSync(join(art.dest, rel))) {
      throw new Error(
        `post-extract validation failed: expected "${rel}" under ${art.dest}. ` +
          `The upstream zip layout may have changed.`,
      );
    }
  }
}

// Mirror CryptPad: the bundled help/dictionary dirs are large and useless for an
// embedded editor. Pruned by default; pass --keep-help to retain them.
function pruneHelp() {
  const editors = ["documenteditor", "presentationeditor", "spreadsheeteditor", "common"];
  let pruned = 0;
  for (const ed of editors) {
    const help = join(OUT, "web-apps", "apps", ed, "main", "resources", "help");
    if (existsSync(help)) {
      rmSync(help, { recursive: true, force: true });
      pruned++;
    }
  }
  const dicts = join(OUT, "dictionaries");
  if (existsSync(dicts)) {
    rmSync(dicts, { recursive: true, force: true });
    pruned++;
  }
  if (pruned) log(`  pruned ${pruned} help/dictionary dir(s)`);
}

function writeNotice() {
  const notice = `ONLYOFFICE engine — third-party vendored assets
================================================

The contents of this directory (sdkjs/, web-apps/, fonts/, x2t/) are NOT part of
Xenode's source. They are fetched at build time by scripts/vendor-onlyoffice.mjs
from CryptPad's prebuilt, offline-capable ONLYOFFICE distribution.

Pinned versions
  - ONLYOFFICE editor (sdkjs + web-apps): ${ARTIFACTS.editor.version}
      ${ARTIFACTS.editor.url}
  - x2t WASM converter: ${ARTIFACTS.x2t.version}
      ${ARTIFACTS.x2t.url}

License
  ONLYOFFICE Document Server components (sdkjs, web-apps) and CryptPad's offline
  build are licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).
  Because Xenode serves these assets to users over a network, AGPL-3.0 section 13
  applies: users must be offered the Corresponding Source of these components.

  Corresponding Source:
    - https://github.com/cryptpad/onlyoffice-editor (release ${ARTIFACTS.editor.version})
    - https://github.com/cryptpad/onlyoffice-x2t-wasm (release ${ARTIFACTS.x2t.version})
    - https://github.com/cryptpad/sdkjs and https://github.com/cryptpad/web-apps
    - Upstream: https://github.com/ONLYOFFICE

  Keep this notice and surface the source links to end users (e.g. an "open-source
  licenses" page) to satisfy the AGPL-3.0 offer.

Regenerate with:  npm run vendor:onlyoffice
`;
  writeFileSync(join(OUT, "THIRD-PARTY-NOTICE.txt"), notice);
}

async function main() {
  if (ONLY && !ARTIFACTS[ONLY]) {
    throw new Error(`--only must be one of: ${Object.keys(ARTIFACTS).join(", ")}`);
  }
  if (FROM_FILE && !ONLY) {
    throw new Error(
      "--from-file requires --only=editor or --only=x2t (one artifact per local file).",
    );
  }

  const prior = existsSync(MARKER)
    ? JSON.parse(readFileSync(MARKER, "utf8"))
    : {};
  const targets = ONLY ? [ONLY] : Object.keys(ARTIFACTS);

  // A supplied --from-file always (re)extracts — never short-circuit on it.
  const upToDate =
    !FORCE &&
    !FROM_FILE &&
    targets.every((k) => prior[k] === ARTIFACTS[k].version) &&
    targets.every((k) => existsSync(ARTIFACTS[k].dest));
  if (upToDate) {
    log(`already vendored (${targets.map((k) => `${k} ${prior[k]}`).join(", ")}). Use --force to refetch.`);
    return;
  }

  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "xenode-oo-"));
  try {
    for (const key of targets) {
      await vendor(key, ARTIFACTS[key], tmp, FROM_FILE && key === ONLY ? FROM_FILE : null);
    }
    if (targets.includes("editor") && !KEEP_HELP) pruneHelp();

    const marker = { ...prior };
    for (const key of targets) marker[key] = ARTIFACTS[key].version;
    writeFileSync(MARKER, JSON.stringify(marker, null, 2) + "\n");
    writeNotice();

    log("done. Assets are under public/onlyoffice/ (gitignored).");
    log("Next: the engine glue (public/onlyoffice/engine.js + editor.html + manifest.json).");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`[vendor:onlyoffice] ERROR: ${err.message}\n`);
  process.exit(1);
});
