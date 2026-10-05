import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORAGE_REGION,
  isStorageRegion,
  requireRegionBucketCredentials,
  resolveRegionBucketConfig,
  resolveSystemBucketConfig,
  STORAGE_REGIONS,
  enabledStorageRegions,
  regionForBucketName,
  validateStorageDeployment,
} from "../src/storage";

const FULL_ENV = {
  STORAGE_ENABLED_REGIONS: "asia,us,eu",
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

  it("refuses a disabled or incompletely provisioned pool", () => {
    expect(() => resolveRegionBucketConfig("eu", {})).toThrow("not enabled");
    expect(() => resolveRegionBucketConfig("us", { ...FULL_ENV, S3_US_BUCKET_NAME: "" }))
      .toThrow("S3_US_BUCKET_NAME and S3_US_ENDPOINT are required");
    expect(() => validateStorageDeployment({ ...FULL_ENV, S3_EU_APPLICATION_KEY: "" }))
      .toThrow("configured together");
    expect(() => requireRegionBucketCredentials("asia", {
      S3_BUCKET_NAME: "explicit", S3_ENDPOINT: FULL_ENV.S3_ENDPOINT,
    })).toThrow("credentials are not configured");
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
    })).toThrow(/BUCKET_NAME and S3_ENDPOINT are required/);
  });

  it("validates the non-secret enabled list and a complete deployment", () => {
    expect(enabledStorageRegions({})).toEqual(["asia"]);
    expect([...validateStorageDeployment(FULL_ENV).keys()]).toEqual(STORAGE_REGIONS);
    expect(() => enabledStorageRegions({ STORAGE_ENABLED_REGIONS: "asia,asia" })).toThrow("unique");
    expect(() => enabledStorageRegions({ STORAGE_ENABLED_REGIONS: "us" })).toThrow("including asia");
    expect(() => enabledStorageRegions({ STORAGE_ENABLED_REGIONS: "asia,moon" })).toThrow("supported");
    expect(() => validateStorageDeployment({ ...FULL_ENV, STORAGE_ENABLED_REGIONS: "asia" }))
      .toThrow("configured but not declared");
    expect(() => validateStorageDeployment({})).toThrow("required");
  });

  it("never guesses unknown or ambiguous physical bucket routing", () => {
    expect(regionForBucketName("xenode-us", FULL_ENV)).toBe("us");
    expect(() => regionForBucketName("unknown", FULL_ENV)).toThrow("unknown or ambiguous");
    const duplicate = { ...FULL_ENV, S3_US_BUCKET_NAME: FULL_ENV.S3_BUCKET_NAME };
    expect(() => regionForBucketName("xenode-asia", duplicate)).toThrow("ambiguous");
    expect(() => validateStorageDeployment(duplicate)).toThrow("distinct bucket names");
  });

  it("requires jurisdiction endpoints for advertised US/EU pools", () => {
    expect(() => resolveRegionBucketConfig("us", { ...FULL_ENV, S3_US_ENDPOINT: FULL_ENV.S3_ENDPOINT }))
      .toThrow("us jurisdiction endpoint");
    expect(() => resolveRegionBucketConfig("eu", { ...FULL_ENV, S3_EU_ENDPOINT: FULL_ENV.S3_US_ENDPOINT }))
      .toThrow("eu jurisdiction endpoint");
  });

  it.each([
    "https://user:secret@example.r2.cloudflarestorage.com", "https://example.r2.cloudflarestorage.com:8080",
    "https://example.r2.cloudflarestorage.com/path", "https://example.r2.cloudflarestorage.com?x=1",
  ])("rejects credentials, ports and URL suffixes without exposing values", (endpoint) => {
    expect(() => resolveRegionBucketConfig("asia", { ...FULL_ENV, S3_ENDPOINT: endpoint }))
      .toThrow("Cloudflare R2 S3 endpoint");
  });
});
