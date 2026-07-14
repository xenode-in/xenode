import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

const target = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  console.error("Usage: node scripts/onlyoffice/sanitize-client.mjs <artifact-directory>");
  process.exit(1);
}

const serviceWorkerFile = /^(?:document_editor_service_worker|service-?worker)\.js$/i;
const registration = /navigator\.serviceWorker\.register\([^\r\n)]*\)/g;
const disabledRegistration =
  'Promise.reject(new Error("Service workers are disabled in the Xenode editor runtime"))';
let removedFiles = 0;
let rewrittenFiles = 0;

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const artifactPath = relative(target, path).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }

    if (
      serviceWorkerFile.test(basename(path)) ||
      /^xenode\/lab(?:-parent)?\.html$/i.test(artifactPath)
    ) {
      await rm(path, { force: true });
      removedFiles += 1;
      continue;
    }

    if (![".html", ".js", ".mjs"].includes(extname(path).toLowerCase())) continue;
    const source = await readFile(path, "utf8");
    const sanitized = source.replace(registration, disabledRegistration);
    if (sanitized !== source) {
      await writeFile(path, sanitized, "utf8");
      rewrittenFiles += 1;
    }
  }
}

await walk(target);
console.log(
  `Sanitized ONLYOFFICE artifact: ${rewrittenFiles} registrations disabled, ` +
    `${removedFiles} service-worker/lab files removed`,
);
