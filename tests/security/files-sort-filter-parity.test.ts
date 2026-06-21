import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");

describe("Files sort and filter parity", () => {
  it("keeps sort and filter controls available on Android search", () => {
    const search = readFileSync(
      path.join(repoRoot, "xenode-expo/src/app/(drive)/search.tsx"),
      "utf8",
    );
    const controls = readFileSync(
      path.join(
        repoRoot,
        "xenode-expo/src/components/files/SortFilterBar.tsx",
      ),
      "utf8",
    );

    expect(search).toContain("<SortFilterBar");
    expect(search).toContain("matchesFilter(item, filterType)");
    expect(search).toContain("sortItems(");
    expect(controls).toContain('sortBy === "date"');
    expect(controls).toContain('"Smallest"');
  });

  it("paginates the active Android folder before local sorting", () => {
    const mobileFiles = readFileSync(
      path.join(
        repoRoot,
        "xenode-expo/src/app/(drive)/(tabs)/index.tsx",
      ),
      "utf8",
    );
    const mobileObjects = readFileSync(
      path.join(repoRoot, "xenode-expo/src/api/objects.ts"),
      "utf8",
    );

    expect(mobileObjects).toContain("export async function listFolderObjects");
    expect(mobileObjects).toContain("prefix: params.prefix");
    expect(mobileFiles).toContain("DriveCacheDb.getFolder");
    expect(mobileFiles).toContain("await listFolderObjects");
    expect(mobileFiles).toContain("onEndReached=");
    expect(mobileFiles).toContain("load({ loadMore: true })");
    expect(mobileFiles).toContain("const displayData = useMemo");
    expect(mobileFiles).toContain("const sortedFiles = sortFiles");
    expect(mobileFiles).toContain("data={displayData as any}");
    expect(mobileFiles).toContain("getItemType=");
    expect(mobileFiles).toContain("drawDistance=");
  });

  it("filters the Web dashboard from the complete local object set", () => {
    const filesPage = readFileSync(
      path.join(
        repoRoot,
        "xenode-nextjs/app/(dashboard)/dashboard/files/page.tsx",
      ),
      "utf8",
    );

    expect(filesPage).toContain("const FILTER_OPTIONS");
    expect(filesPage).toContain("matchesFilter(obj, typeFilter)");
    expect(filesPage).toContain("filterType={normalizeFilter(typeFilter)}");
    expect(filesPage).not.toContain("mediaCategory: typeFilter");
    expect(filesPage).not.toContain("f.mediaCategory === typeFilter");
  });
});
