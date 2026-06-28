import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const expoRoot = path.join(repoRoot, "xenode-expo");

describe("Mobile manifest and foreground performance parity", () => {
  it("uses a lightweight manifest without signed thumbnail URLs", () => {
    const route = readFileSync(
      path.join(
        repoRoot,
        "xenode-nextjs/app/api/objects/manifest/route.ts",
      ),
      "utf8",
    );
    const dashboard = readFileSync(
      path.join(expoRoot, "src/app/(drive)/(tabs)/index.tsx"),
      "utf8",
    );
    const photos = readFileSync(
      path.join(expoRoot, "src/app/(drive)/photos.tsx"),
      "utf8",
    );

    expect(route).toContain("MANIFEST_PROJECTION");
    expect(route).not.toContain("getSignedFileUrl");
    expect(dashboard).toContain("getObjectsManifestCached");
    expect(dashboard).not.toContain("listFolderObjects");
    expect(photos).toContain("getObjectsManifestCached");
    expect(photos).not.toContain("getObjectsBatch");
  });

  it("throttles backup and local thumbnail work during Photos interaction", () => {
    const coordinator = readFileSync(
      path.join(
        expoRoot,
        "src/performance/ForegroundPerformanceCoordinator.ts",
      ),
      "utf8",
    );
    const engine = readFileSync(
      path.join(expoRoot, "src/sync/SyncEngine.ts"),
      "utf8",
    );
    const thumbnails = readFileSync(
      path.join(
        expoRoot,
        "src/components/gallery_v2/ThumbGeneratorQueue.ts",
      ),
      "utf8",
    );

    expect(coordinator).toContain('"photos_interacting"');
    expect(coordinator).toContain("}, 750)");
    expect(engine).toContain("waitForBackupAdmission");
    expect(engine).toContain("waitForCpuAdmission");
    expect(thumbnails).toContain("canRunLowPriorityThumbnails");
  });
});
