import { describe, expect, it, vi } from "vitest";

vi.unmock("@/lib/posthog");

describe("privacy-safe analytics helpers", () => {
  it("drops forbidden analytics properties", async () => {
    const { sanitizeAnalyticsProperties } = await import("@/lib/posthog");

    expect(
      sanitizeAnalyticsProperties({
        bucketName: "tax docs",
        fileName: "passport.pdf",
        bucketId: "bucket_123",
        recipientEmail: "friend@example.com",
        encryptedDEK: "secret",
        sizeBucket: "10mb_100mb",
        isEncrypted: true,
        source: "web",
      }),
    ).toEqual({
      sizeBucket: "10mb_100mb",
      isEncrypted: true,
      source: "web",
    });
  });

  it("sanitizes page paths and urls before capture", async () => {
    const { sanitizeAnalyticsPath, sanitizeAnalyticsUrl } = await import(
      "@/lib/analytics"
    );
    const { sanitizeAnalyticsProperties } = await import("@/lib/posthog");

    expect(sanitizeAnalyticsPath("/shared/share_token_123456")).toBe(
      "/shared/[token]",
    );
    expect(sanitizeAnalyticsPath("/dashboard/_buckets/bucket_123456789")).toBe(
      "/dashboard/_buckets/[bucketId]",
    );
    expect(
      sanitizeAnalyticsUrl("https://xenode.app/shared/share_token_123456?pw=1"),
    ).toBe("https://xenode.app/shared/[token]");
    expect(
      sanitizeAnalyticsProperties({
        path: "/dashboard/shared-with-me/64d9f230aa22cc44dd66ee88",
        $current_url:
          "https://xenode.app/dashboard/_buckets/bucket_123456789?name=tax",
      }),
    ).toEqual({
      path: "/dashboard/shared-with-me/[id]",
      $current_url: "https://xenode.app/dashboard/_buckets/[bucketId]",
    });
  });

  it("buckets file sizes instead of preserving exact values", async () => {
    const { sizeBucket } = await import("@/lib/posthog");

    expect(sizeBucket(512 * 1024)).toBe("lt_1mb");
    expect(sizeBucket(5 * 1024 * 1024)).toBe("1mb_10mb");
    expect(sizeBucket(50 * 1024 * 1024)).toBe("10mb_100mb");
    expect(sizeBucket(500 * 1024 * 1024)).toBe("100mb_1gb");
  });
});
