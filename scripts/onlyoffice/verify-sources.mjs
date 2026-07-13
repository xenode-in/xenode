import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const release = JSON.parse(
  readFileSync(resolve(root, "tools/onlyoffice/release.json"), "utf8"),
);

let failed = false;

for (const [name, expected] of Object.entries(release.repositories)) {
  const directory = resolve(root, "vendor/onlyoffice", name);
  const result = spawnSync("git", ["-C", directory, "rev-parse", "HEAD"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const actual = result.stdout.trim();
  const ok = result.status === 0 && actual === expected.commit;
  console.log(`${ok ? "OK" : "FAIL"} ${name}: ${actual || result.stderr.trim()}`);
  if (!ok) failed = true;

  const tag = spawnSync(
    "git",
    ["-C", directory, "show-ref", "--verify", `refs/tags/${expected.tag}`],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  if (tag.status !== 0) {
    console.error(`FAIL ${name}: missing tag ${expected.tag}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`Verified ONLYOFFICE ${release.release} source set.`);
