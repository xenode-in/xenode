import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStorageConfigCacheForTests,
  STORAGE_REGIONS,
} from "@xenode/config/storage";
import { bucketOwnershipClause } from "@/lib/authz/policy";
import type { AccessContext } from "@/lib/authz/space-context";
import { ensureSystemWorkspaceBucketRecord } from "@/lib/storage/workspaceBucket";
import Bucket from "@/models/Bucket";
import { bucketExists } from "@/lib/b2/buckets";
import { ensureWorkspaceBucket } from "@/lib/storage/workspaceBucket";
import { resolveAccountStorageRegion, resolveOrgStorageRegion } from "@/lib/storage/region";
import { AccountProfile } from "@xenode/database";
import OrgUsage from "@/models/OrgUsage";

const REGION_ENV = {
  STORAGE_ENABLED_REGIONS: "asia,us,eu",
  S3_BUCKET_NAME: "xenode-test-asia",
  S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
  S3_REGION: "auto",
  S3_KEY_ID: "test-key",
  S3_APPLICATION_KEY: "test-secret",
  S3_US_BUCKET_NAME: "xenode-test-us",
  S3_US_ENDPOINT: "https://example.us.r2.cloudflarestorage.com",
  S3_US_REGION: "auto",
  S3_US_KEY_ID: "test-key",
  S3_US_APPLICATION_KEY: "test-secret",
  S3_EU_BUCKET_NAME: "xenode-test-eu",
  S3_EU_ENDPOINT: "https://example.eu.r2.cloudflarestorage.com",
  S3_EU_REGION: "auto",
  S3_EU_KEY_ID: "test-key",
  S3_EU_APPLICATION_KEY: "test-secret",
} as const;

const previousEnv = new Map<string, string | undefined>();

beforeEach(() => {
  vi.mocked(bucketExists).mockReset().mockResolvedValue(true);
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
  it("refuses unavailable buckets before creating or relabelling metadata", async () => {
    vi.mocked(bucketExists).mockResolvedValueOnce(false);
    await expect(ensureSystemWorkspaceBucketRecord("PERSONAL", "asia")).rejects.toThrow("unavailable");
    expect(await Bucket.countDocuments()).toBe(0);
    const existing = await Bucket.create({ systemKey: "drive", storageRegion: "asia", name: "old-bucket", b2BucketId: "old-bucket", region: "auto" });
    await expect(ensureSystemWorkspaceBucketRecord("PERSONAL", "asia")).rejects.toThrow("conflicts");
    expect((await Bucket.findById(existing._id))?.b2BucketId).toBe("old-bucket");
  });

  it("retains verification failures and competing metadata mappings", async () => {
    vi.mocked(bucketExists).mockRejectedValueOnce(new Error("permission denied"));
    await expect(ensureWorkspaceBucket("ORGANIZATION", "us")).rejects.toThrow("permission denied");
    const [first, retry] = await Promise.all([
      ensureSystemWorkspaceBucketRecord("PERSONAL", "us"), ensureSystemWorkspaceBucketRecord("PERSONAL", "us"),
    ]);
    expect(String(first._id)).toBe(String(retry._id));
    expect(await Bucket.countDocuments()).toBe(1);
  });

  it("never routes corrupt stored owner regions to the default pool", async () => {
    await AccountProfile.create({ accountId: "region-account", storageRegion: "asia" });
    await AccountProfile.collection.updateOne({ accountId: "region-account" }, { $set: { storageRegion: "moon" } });
    await OrgUsage.create({ orgId: "region-org", storageRegion: "asia" });
    await OrgUsage.collection.updateOne({ orgId: "region-org" }, { $set: { storageRegion: "moon" } });
    await expect(resolveAccountStorageRegion("region-account")).rejects.toThrow("invalid");
    await expect(resolveOrgStorageRegion("region-org")).rejects.toThrow("invalid");
  });

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
