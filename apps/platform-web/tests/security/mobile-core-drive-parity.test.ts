import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { matchesDriveSearch } from "../../../../../xenode-expo/src/lib/driveSearch";
import {
  mergeRecentSearch,
  recentSearchesKey,
} from "../../../../../xenode-expo/src/lib/recentSearches";

const mobileRoot = path.resolve(__dirname, "../../../xenode-expo");

describe("Android core drive parity", () => {
  it("searches decrypted filenames locally without requiring ciphertext names", () => {
    expect(
      matchesDriveSearch(
        {
          decryptedName: "Quarterly Report.pdf",
          key: "users/a/opaque-key",
          contentType: "application/pdf",
        },
        "report",
      ),
    ).toBe(true);
    expect(
      matchesDriveSearch(
        {
          decryptedName: "Vacation.jpg",
          key: "users/a/opaque-key",
          contentType: "image/jpeg",
        },
        "report",
      ),
    ).toBe(false);

    expect(mergeRecentSearch(["photos", "report"], "REPORT")).toEqual([
      "REPORT",
      "photos",
    ]);
    expect(recentSearchesKey("user-a")).not.toBe(recentSearchesKey("user-b"));
  });

  it("keeps search, recovery-kit export, and Bin-aware deletion reachable", () => {
    const header = readFileSync(
      path.join(mobileRoot, "src/components/GlobalHeader.tsx"),
      "utf8",
    );
    const files = readFileSync(
      path.join(mobileRoot, "src/app/(drive)/(tabs)/index.tsx"),
      "utf8",
    );
    const onboarding = readFileSync(
      path.join(mobileRoot, "src/app/(auth)/onboarding.tsx"),
      "utf8",
    );
    const bin = readFileSync(
      path.join(mobileRoot, "src/app/(drive)/bin.tsx"),
      "utf8",
    );
    const search = readFileSync(
      path.join(mobileRoot, "src/app/(drive)/search.tsx"),
      "utf8",
    );

    expect(header).toContain('router.push("/(drive)/search"');
    expect(search).toContain("Animated.spring(entrance");
    expect(search).toContain("loadRecentSearches(userId)");
    expect(search).toContain("saveRecentSearch(userId");
    expect(files).toContain("useLocalSearchParams");
    expect(files).toContain("This moves the item to the Bin.");
    // Manual drive upload now routes through the shared streaming engine hook
    // (useManualUpload) instead of the old in-file uploadTemporaryFile helper;
    // temp-file cleanup is still guaranteed via finally + deleteAsync.
    expect(files).toContain("useManualUpload");
    expect(files).toContain("finally {");
    expect(files).toContain("deleteAsync");
    expect(onboarding).toContain("formatRecoveryKitDownload(kit.words)");
    expect(onboarding).toContain("Download Kit");
    expect(bin).toContain("useFocusEffect(");
    expect(bin).toContain("alwaysBounceVertical");
    expect(bin).toContain("Pull down to refresh.");
  });
});
