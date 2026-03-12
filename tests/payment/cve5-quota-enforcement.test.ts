/**
 * CVE-5: Quota Enforcement at Presign Time
 *
 * Tests that /api/objects/presign-upload refuses to issue a presigned URL
 * when the user's storage is at or over their plan limit.
 *
 * FIX NOTES:
 * - Usage is a default export; use default import not named destructure.
 *   { Usage } = import('@/models/Usage') returns undefined because models
 *   export `export default model(...)` not `export const Usage`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Usage from "@/models/Usage";           // ← default import (fixed)
import Bucket from "@/models/Bucket";
import { makeUserId, createUsage, PRO_100_BYTES, FREE_TIER_BYTES } from "../helpers/factories";

async function seedBucket(userId: string) {
  return Bucket.create({
    userId,
    name: "test-bucket",
    b2BucketId: "b2-test-bucket-id",
    isPublic: false,
  });
}

describe("CVE-5 — Quota Enforcement at Presign", () => {
  beforeEach(() => {
    vi.mock("@aws-sdk/client-s3", () => ({ S3Client: vi.fn(), PutObjectCommand: vi.fn() }));
    vi.mock("@aws-sdk/s3-request-presigner", () => ({
      getSignedUrl: vi.fn().mockResolvedValue("https://b2.example.com/presigned-url"),
    }));
    process.env.B2_KEY_ID = "test-key";
    process.env.B2_APPLICATION_KEY = "test-app-key";
  });

  it("issues presigned URL when user is under quota", async () => {
    const userId = makeUserId();
    const { requireAuth } = await import("@/lib/auth/session");
    vi.mocked(requireAuth).mockResolvedValue({ user: { id: userId } } as any);

    await createUsage({ userId, totalStorageBytes: 1_000_000, storageLimitBytes: FREE_TIER_BYTES });
    const bucket = await seedBucket(userId);

    const req = new Request("http://localhost/api/objects/presign-upload", {
      method: "POST",
      body: JSON.stringify({ fileSize: 1_000_000, fileType: "image/jpeg", bucketId: bucket._id.toString() }),
      headers: { "Content-Type": "application/json" },
    });

    const { POST } = await import("@/app/api/objects/presign-upload/route");
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadUrl).toBeDefined();
    expect(body.objectKey).toMatch(/^users\/.+\/.{32}$/);
  });

  it("returns 402 when projected usage exceeds storageLimitBytes", async () => {
    const userId = makeUserId();
    const { requireAuth } = await import("@/lib/auth/session");
    vi.mocked(requireAuth).mockResolvedValue({ user: { id: userId } } as any);

    const nearLimit = FREE_TIER_BYTES - 100;
    await createUsage({ userId, totalStorageBytes: nearLimit, storageLimitBytes: FREE_TIER_BYTES });
    const bucket = await seedBucket(userId);

    const req = new Request("http://localhost/api/objects/presign-upload", {
      method: "POST",
      body: JSON.stringify({ fileSize: 1_000, fileType: "image/jpeg", bucketId: bucket._id.toString() }),
      headers: { "Content-Type": "application/json" },
    });

    const { POST } = await import("@/app/api/objects/presign-upload/route");
    const res = await POST(req as any);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("storage_quota_exceeded");
  });

  it("downgrades an expired pro plan to free inline and then enforces new quota", async () => {
    const userId = makeUserId();
    const { requireAuth } = await import("@/lib/auth/session");
    vi.mocked(requireAuth).mockResolvedValue({ user: { id: userId } } as any);

    await createUsage({
      userId,
      plan: "pro",
      totalStorageBytes: 1 * 1024 * 1024 * 1024,
      storageLimitBytes: PRO_100_BYTES,
      planExpiresAt: new Date(Date.now() - 1000),
      planPriceINR: 149,
    });
    const bucket = await seedBucket(userId);

    const req = new Request("http://localhost/api/objects/presign-upload", {
      method: "POST",
      body: JSON.stringify({
        fileSize: 100 * 1024 * 1024,
        fileType: "video/mp4",
        bucketId: bucket._id.toString(),
      }),
      headers: { "Content-Type": "application/json" },
    });

    const { POST } = await import("@/app/api/objects/presign-upload/route");
    const res = await POST(req as any);
    expect(res.status).toBe(200);

    // ← fixed: default import at top of file, not dynamic named destructure
    const usage = await Usage.findOne({ userId });
    expect(usage?.plan).toBe("free");
    expect(usage?.storageLimitBytes).toBe(FREE_TIER_BYTES);
  });
});
