import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  console.error("Usage: node scripts/onlyoffice/verify-client.mjs <artifact-directory>");
  process.exit(1);
}

const required = [
  "version.json",
  "web-apps/apps/api/documents/api.js",
  "web-apps/apps/documenteditor/main/app.js",
  "web-apps/apps/spreadsheeteditor/main/app.js",
  "sdkjs/word/sdk-all.js",
  "sdkjs/word/sdk-all-min.js",
  "sdkjs/cell/sdk-all.js",
  "sdkjs/cell/sdk-all-min.js",
];

let failed = false;
for (const relative of required) {
  const ok = existsSync(resolve(target, relative));
  console.log(`${ok ? "OK" : "MISSING"} ${relative}`);
  if (!ok) failed = true;
}

if (!failed) {
  const version = JSON.parse(readFileSync(resolve(target, "version.json"), "utf8"));
  if (version.onlyoffice !== "9.4.0" || version.build !== 131) {
    console.error("Unexpected ONLYOFFICE artifact version", version);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`Verified ONLYOFFICE client artifact at ${target}`);
