import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearStorageConfigCacheForTests,
  STORAGE_REGIONS,
} from "@xenode/config/storage";
import { bucketOwnershipClause } from "@/lib/authz/policy";
import type { AccessContext } from "@/lib/authz/space-context";
import { ensureSystemWorkspaceBucketRecord } from "@/lib/storage/workspaceBucket";
import Bucket from "@/models/Bucket";

const REGION_ENV = {
  S3_BUCKET_NAME: "xenode-test-asia",
  S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
  S3_REGION: "auto",
  S3_KEY_ID: "test-key",
  S3_APPLICATION_KEY: "test-secret",
  S3_US_BUCKET_NAME: "xenode-test-us",
  S3_US_ENDPOINT: "https://example.r2.cloudflarestorage.com",
  S3_US_REGION: "auto",
  S3_US_KEY_ID: "test-key",
  S3_US_APPLICATION_KEY: "test-secret",
  S3_EU_BUCKET_NAME: "xenode-test-eu",
  S3_EU_ENDPOINT: "https://example.r2.cloudflarestorage.com",
  S3_EU_REGION: "auto",
  S3_EU_KEY_ID: "test-key",
  S3_EU_APPLICATION_KEY: "test-secret",
} as const;

const previousEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const [key, value] of Object.entries(REGION_ENV)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }
  clearStorageConfigCacheForTests();
});

afterEach(() => {
  for (const key of Object.keys(REGION_ENV)) {
    const previous = previousEnv.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  previousEnv.clear();
  clearStorageConfigCacheForTests();
});

describe("regional system buckets", () => {
  it("persists one drive bucket record per logical storage region", async () => {
    const records = await Promise.all(
      STORAGE_REGIONS.map((region) =>
        ensureSystemWorkspaceBucketRecord("PERSONAL", region),
      ),
    );

    expect(records.map((record) => record.storageRegion).sort()).toEqual([
      "asia",
      "eu",
      "us",
    ]);
    expect(records.map((record) => record.b2BucketId).sort()).toEqual([
      "xenode-test-asia",
      "xenode-test-eu",
      "xenode-test-us",
    ]);
    await expect(Bucket.countDocuments({ systemKey: "drive" })).resolves.toBe(3);
  });

  it("authorizes only the bucket selected by the access context region", () => {
    const ctx = { region: "us" } as AccessContext;

    expect(bucketOwnershipClause(ctx)).toEqual({
      systemKey: "drive",
      storageRegion: "us",
      name: "xenode-test-us",
      b2BucketId: "xenode-test-us",
    });
  });
});
