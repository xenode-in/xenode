import { describe, expect, it } from "vitest";
import { cookieNames, createProductRegistry, readFeatureFlag } from "../src";
import { getServerEnv } from "../src/server";
import { resolveSystemBucketConfig } from "../src/storage";

describe("shared config", () => {
  it("uses host-only product cookie names", () => {
    expect(cookieNames.accountsSession.startsWith("__Host-")).toBe(true);
    expect(cookieNames.driveSession).not.toBe(cookieNames.photosSession);
  });

  it("exposes canonical product origins", () => {
    expect(createProductRegistry().accounts.origin.href).toBe(
      "https://accounts.xenode.in/",
    );
  });

  it("reads flags strictly", () => {
    expect(readFeatureFlag("ORGS_ENABLED", { ORGS_ENABLED: "true" })).toBe(true);
    expect(readFeatureFlag("ORGS_ENABLED", { ORGS_ENABLED: "1" })).toBe(false);
  });

  it("fails fast when mandatory server secrets are absent", () => {
    expect(() =>
      getServerEnv({ MONGODB_URI: "mongodb://localhost/test" }),
    ).toThrow();
  });

  it("resolves one cached system bucket shape", () => {
    const config = resolveSystemBucketConfig({
      S3_BUCKET_NAME: "xenode-test-storage",
      S3_REGION: "test-region",
      S3_ENDPOINT: "https://storage.example.test",
    });
    expect(config).toMatchObject({
      bucketName: "xenode-test-storage",
      region: "test-region",
    });
  });
});
