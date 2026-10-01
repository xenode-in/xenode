import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORAGE_REGION,
  isStorageRegion,
  requireRegionBucketCredentials,
  resolveRegionBucketConfig,
  resolveSystemBucketConfig,
  STORAGE_REGIONS,
} from "../src/storage";

const FULL_ENV = {
  // asia (unprefixed)
  S3_BUCKET_NAME: "xenode-asia",
  S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
  S3_REGION: "auto",
  S3_KEY_ID: "asia-key",
  S3_APPLICATION_KEY: "asia-secret",
  // us
  S3_US_BUCKET_NAME: "xenode-us",
  S3_US_ENDPOINT: "https://example.us.r2.cloudflarestorage.com",
  S3_US_REGION: "auto",
  S3_US_KEY_ID: "us-key",
  S3_US_APPLICATION_KEY: "us-secret",
  // eu
  S3_EU_BUCKET_NAME: "xenode-eu",
  S3_EU_ENDPOINT: "https://example.eu.r2.cloudflarestorage.com",
  S3_EU_REGION: "auto",
  S3_EU_KEY_ID: "eu-key",
  S3_EU_APPLICATION_KEY: "eu-secret",
};

describe("multi-region storage config", () => {
  it("knows its region set", () => {
    expect(STORAGE_REGIONS).toEqual(["asia", "us", "eu"]);
    expect(DEFAULT_STORAGE_REGION).toBe("asia");
    expect(isStorageRegion("us")).toBe(true);
    expect(isStorageRegion("mars")).toBe(false);
  });

  it("resolves each region to its own bucket + credentials", () => {
    expect(resolveRegionBucketConfig("asia", FULL_ENV)).toMatchObject({
      bucketName: "xenode-asia",
      credentials: { accessKeyId: "asia-key" },
    });
    expect(resolveRegionBucketConfig("us", FULL_ENV)).toMatchObject({
      bucketName: "xenode-us",
      endpoint: "https://example.us.r2.cloudflarestorage.com",
      region: "auto",
      credentials: { accessKeyId: "us-key" },
    });
    expect(resolveRegionBucketConfig("eu", FULL_ENV)).toMatchObject({
      bucketName: "xenode-eu",
      credentials: { accessKeyId: "eu-key" },
    });
  });

  it("default resolver == asia", () => {
    expect(resolveSystemBucketConfig(FULL_ENV).bucketName).toBe("xenode-asia");
  });

  it("returns a fresh (mutable) credentials object for the AWS SDK", () => {
    const creds = resolveRegionBucketConfig("us", FULL_ENV).credentials!;
    expect(() => {
      (creds as unknown as { $source?: unknown }).$source = {};
    }).not.toThrow();
  });

  it("an unconfigured region resolves without credentials and errors only on use", () => {
    const cfg = resolveRegionBucketConfig("eu", { S3_KEY_ID: "x", S3_APPLICATION_KEY: "y" });
    expect(cfg.credentials).toBeUndefined();
    expect(() =>
      requireRegionBucketCredentials("eu", { S3_KEY_ID: "x", S3_APPLICATION_KEY: "y" }),
    ).toThrow(/not configured for region "eu"/);
  });

  it("rejects non-R2 endpoints and signing regions", () => {
    expect(() => resolveRegionBucketConfig("asia", {
      ...FULL_ENV, S3_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    })).toThrow(/Cloudflare R2 S3 endpoint/);
    expect(() => resolveRegionBucketConfig("asia", {
      ...FULL_ENV, S3_REGION: "us-west-004",
    })).toThrow(/signing region "auto"/);
    expect(() => requireRegionBucketCredentials("asia", {
      S3_KEY_ID: "id", S3_APPLICATION_KEY: "secret",
    })).toThrow(/endpoint is not configured/);
  });
});
