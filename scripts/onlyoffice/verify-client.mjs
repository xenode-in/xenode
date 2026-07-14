import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";

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

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const forbidden = [];
for (const path of filesUnder(target)) {
  const artifactPath = relative(target, path).replaceAll("\\", "/");
  if (
    /^(?:document_editor_service_worker|service-?worker)\.js$/i.test(basename(path)) ||
    /^xenode\/lab(?:-parent)?\.html$/i.test(artifactPath)
  ) {
    forbidden.push(artifactPath);
    continue;
  }
  if ([".html", ".js", ".mjs"].includes(extname(path).toLowerCase())) {
    const source = readFileSync(path, "utf8");
    if (source.includes("navigator.serviceWorker.register")) forbidden.push(artifactPath);
  }
}
if (forbidden.length) {
  console.error("Forbidden service-worker or lab artifact files:", forbidden);
  failed = true;
}

if (!failed) {
  const version = JSON.parse(
    readFileSync(resolve(target, "version.json"), "utf8").replace(/^\uFEFF/, ""),
  );
  const approved =
    (version.onlyoffice === "9.4.0" && version.build === 131) ||
    (version.onlyoffice === "9.3.0" && version.build === 140);
  if (!approved) {
    console.error("Unexpected ONLYOFFICE artifact version", version);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`Verified ONLYOFFICE client artifact at ${target}`);
