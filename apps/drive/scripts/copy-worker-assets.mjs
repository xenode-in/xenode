// Copy runtime UMD bundles that the metadata worker loads via importScripts()
// into /public. Cross-platform (runs under cmd.exe, PowerShell, and POSIX sh).
//
// The metadata worker (lib/metadata/workers/metadata.worker.ts) is a classic
// worker and pulls exifr from same-origin /exifr/exifr.js at runtime, so the
// bundler never touches it.
//
// In the monorepo, node_modules is hoisted to the workspace root, so we resolve
// the exifr bundle via Node module resolution rather than a fixed relative path.

import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let from = null;
try {
  from = require.resolve("exifr/dist/full.umd.js");
} catch {
  from = null;
}

const to = resolve(appRoot, "public/exifr/exifr.js");

if (!from || !existsSync(from)) {
  console.warn("[copy-worker-assets] exifr UMD bundle not found, skipping");
} else {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`[copy-worker-assets] ${from} -> ${to}`);
}
