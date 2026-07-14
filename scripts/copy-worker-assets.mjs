// Copy runtime UMD bundles that the metadata worker loads via importScripts()
// into /public. Cross-platform (runs under cmd.exe, PowerShell, and POSIX sh).
//
// The metadata worker (lib/metadata/workers/metadata.worker.ts) is a classic
// worker and pulls exifr from same-origin /exifr/exifr.js at runtime, so the
// bundler never touches it.

import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const assets = [
  {
    from: resolve(root, "node_modules/exifr/dist/full.umd.js"),
    to: resolve(root, "public/exifr/exifr.js"),
  },
];

for (const { from, to } of assets) {
  if (!existsSync(from)) {
    console.warn(`[copy-worker-assets] source missing, skipping: ${from}`);
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`[copy-worker-assets] ${from} -> ${to}`);
}
