import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceExtensions = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);
const ignoredDirectories = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "public",
  "vendor",
]);
const importPattern =
  /(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;
const violations = [];

async function filesUnder(directory) {
  const output = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (ignoredDirectories.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (sourceExtensions.has(path.extname(entry.name))) output.push(absolute);
    }
  }
  await visit(directory);
  return output;
}

async function workspaceDirectories(kind) {
  const base = path.join(root, kind);
  return (await readdir(base, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(base, entry.name));
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function resolveRelativeImport(file, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  return path.resolve(path.dirname(file), specifier);
}

const packageDirs = await workspaceDirectories("packages");
const appDirs = await workspaceDirectories("apps");
const packageNames = new Map();
for (const directory of packageDirs) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
  packageNames.set(manifest.name, directory);
}

const graph = new Map([...packageNames.keys()].map((name) => [name, new Set()]));
for (const directory of [...packageDirs, ...appDirs]) {
  for (const file of await filesUnder(directory)) {
    const contents = await readFile(file, "utf8");
    const currentPackage = packageDirs.find((candidate) =>
      file.startsWith(`${candidate}${path.sep}`),
    );
    const currentApp = appDirs.find((candidate) =>
      file.startsWith(`${candidate}${path.sep}`),
    );
    const isClientModule = /^\s*["']use client["'];?/m.test(
      contents.slice(0, 300),
    );

    for (const match of contents.matchAll(importPattern)) {
      const specifier = match[1];
      const resolved = resolveRelativeImport(file, specifier);
      if (
        currentPackage &&
        (resolved?.includes(`${path.sep}apps${path.sep}`) ||
          specifier.startsWith("@/"))
      ) {
        violations.push(
          `${relative(file)}: packages must not import app code (${specifier})`,
        );
      }
      if (
        currentApp &&
        resolved?.includes(`${path.sep}apps${path.sep}`) &&
        !resolved.startsWith(currentApp)
      ) {
        violations.push(
          `${relative(file)}: apps must not import another app (${specifier})`,
        );
      }

      const importedWorkspace = [...packageNames.keys()].find(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      );
      if (currentPackage && importedWorkspace) {
        const currentName = [...packageNames.entries()].find(
          ([, value]) => value === currentPackage,
        )?.[0];
        if (currentName && currentName !== importedWorkspace) {
          graph.get(currentName)?.add(importedWorkspace);
        }
      }
      if (
        isClientModule &&
        importedWorkspace &&
        /(?:database|storage-server|identity-server)$/.test(importedWorkspace)
      ) {
        violations.push(
          `${relative(file)}: client modules must not import server package ${importedWorkspace}`,
        );
      }
      if (
        /packages\/(?:contracts|crypto-core)\//.test(relative(file)) &&
        /^(?:next|react|mongoose)(?:\/|$)/.test(specifier)
      ) {
        violations.push(
          `${relative(file)}: portable package imports framework dependency ${specifier}`,
        );
      }
    }
  }
}

const visiting = new Set();
const visited = new Set();
function detectCycle(node, trail = []) {
  if (visiting.has(node)) {
    violations.push(
      `package dependency cycle: ${[...trail, node].join(" -> ")}`,
    );
    return;
  }
  if (visited.has(node)) return;
  visiting.add(node);
  for (const dependency of graph.get(node) ?? []) {
    detectCycle(dependency, [...trail, node]);
  }
  visiting.delete(node);
  visited.add(node);
}
for (const node of graph.keys()) detectCycle(node);

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Boundary check passed (${appDirs.length} apps, ${packageDirs.length} packages).`,
  );
}
