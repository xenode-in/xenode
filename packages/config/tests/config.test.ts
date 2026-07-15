import { describe, expect, it } from "vitest";
import { cookieNames, createProductRegistry, readFeatureFlag } from "../src";
import { getServerEnv } from "../src/server";
import { resolveSystemBucketConfig } from "../src/storage";

const validServerEnv = {
  MONGODB_URI: "mongodb://localhost/test",
  BETTER_AUTH_SECRET: "a".repeat(48),
  ADMIN_JWT_SECRET: "b".repeat(48),
  REALTIME_TICKET_SECRET: "r".repeat(48),
  CDN_SIGNING_SECRET: "c".repeat(48),
  REALTIME_ALLOWED_ORIGIN:
    "https://xenode.in,https://photos.xenode.in",
};

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
    expect(getServerEnv(validServerEnv)).toMatchObject({
      REALTIME_TICKET_SECRET: validServerEnv.REALTIME_TICKET_SECRET,
      CDN_SIGNING_SECRET: validServerEnv.CDN_SIGNING_SECRET,
    });
  });

  it("rejects secret reuse and non-origin realtime allowlists", () => {
    expect(() =>
      getServerEnv({
        ...validServerEnv,
        REALTIME_TICKET_SECRET: validServerEnv.BETTER_AUTH_SECRET,
      }),
    ).toThrow("must not reuse");
    expect(() =>
      getServerEnv({
        ...validServerEnv,
        CDN_SIGNING_SECRET: validServerEnv.REALTIME_TICKET_SECRET,
      }),
    ).toThrow("must not reuse");
    expect(() =>
      getServerEnv({
        ...validServerEnv,
        REALTIME_ALLOWED_ORIGIN: "https://xenode.in/path",
      }),
    ).toThrow("exact http(s) origins");
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
