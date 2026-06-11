#!/usr/bin/env node
/**
 * scripts/cron-trigger.mjs
 *
 * Cross-platform helper to call Xenode cron endpoints locally.
 * Reads CRON_SECRET and APP_URL from .env.local automatically.
 *
 * Usage:
 *   node scripts/cron-trigger.mjs expire-plans
 *   node scripts/cron-trigger.mjs purge-bin
 *   node scripts/cron-trigger.mjs charge-recurring
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Load .env.local ──────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");

try {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // .env.local missing in production — env vars should already be set
}

// ── Config ───────────────────────────────────────────────────────────────────
const SECRET = process.env.CRON_SECRET;
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

if (!SECRET) {
  console.error("❌  CRON_SECRET is not set. Add it to .env.local or your environment.");
  process.exit(1);
}

// ── Job definitions ───────────────────────────────────────────────────────────
const JOBS = {
  "expire-plans": {
    method: "GET",
    path: "/api/cron/expire-plans",
    description: "Downgrade expired plans & grant grace periods",
  },
  "purge-bin": {
    method: "GET",
    path: "/api/cron/purge-bin",
    description: "Hard-delete files in the trash older than 30 days",
  },
  "charge-recurring": {
    method: "POST",
    path: "/api/payment/payu/charge-recurring",
    description: "Trigger PayU auto-renewals for active mandates",
  },
};

// ── Run ───────────────────────────────────────────────────────────────────────
const job = process.argv[2];

if (!job || !JOBS[job]) {
  console.log("Usage:  node scripts/cron-trigger.mjs <job>\n");
  console.log("Available jobs:");
  for (const [name, { description }] of Object.entries(JOBS)) {
    console.log(`  ${name.padEnd(20)} ${description}`);
  }
  process.exit(1);
}

const { method, path } = JOBS[job];
const url = `${APP_URL}${path}`;

console.log(`→ ${method} ${url}`);

const res = await fetch(url, {
  method,
  headers: { Authorization: `Bearer ${SECRET}` },
});

const text = await res.text();

try {
  console.log(JSON.parse(text));
} catch {
  console.log(text);
}

if (!res.ok) {
  console.error(`\n❌  ${res.status} ${res.statusText}`);
  process.exit(1);
}

console.log("\n✅  Done");
