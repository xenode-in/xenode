import { describe, expect, it } from "vitest";
import type { IStorageObjectVersion } from "@/models/StorageObject";
import { versionsTotalBytes } from "@/lib/storage/versions";

describe("protected original storage metering", () => {
  it("does not count the original twice while it is also current", () => {
    const original: IStorageObjectVersion = {
      versionId: "original",
      isOriginal: true,
      sharesCurrentContent: true,
      key: "users/u/source",
      b2FileId: "b2-source",
      size: 4096,
      createdAt: new Date(),
      createdBy: "u",
    };

    expect(versionsTotalBytes([original])).toBe(0);
    original.sharesCurrentContent = false;
    expect(versionsTotalBytes([original])).toBe(4096);
  });
});
