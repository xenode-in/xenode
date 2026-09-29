import { describe, expect, it } from "vitest";
import type { IStorageObjectVersion } from "@/models/StorageObject";
import { storageObjectTotalBytes } from "@xenode/database";

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

    expect(storageObjectTotalBytes({ versions: [original] })).toBe(0);
    original.sharesCurrentContent = false;
    expect(storageObjectTotalBytes({ versions: [original] })).toBe(4096);
  });
});
