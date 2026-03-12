/**
 * GAP-2: incrementStorage Quota Ceiling
 *
 * Tests that incrementStorage throws QUOTA_EXCEEDED when the new
 * upload would push totalStorageBytes over storageLimitBytes.
 */
import { describe, it, expect } from "vitest";
import { incrementStorage } from "@/lib/metering/usage";
import Usage from "@/models/Usage";
import { makeUserId, createUsage, FREE_TIER_BYTES, PRO_100_BYTES } from "../helpers/factories";

describe("GAP-2 — incrementStorage Quota Ceiling", () => {
  it("increments storage when under quota", async () => {
    const userId = makeUserId();
    await createUsage({ userId, totalStorageBytes: 0, storageLimitBytes: FREE_TIER_BYTES });

    await incrementStorage(userId, 1_000_000, { contentType: "image/jpeg", isEncrypted: true });

    const usage = await Usage.findOne({ userId });
    expect(usage?.totalStorageBytes).toBe(1_000_000);
    expect(usage?.uploadCount).toBe(1);
  });

  it("throws QUOTA_EXCEEDED when upload would exceed storageLimitBytes", async () => {
    const userId = makeUserId();
    const nearLimit = FREE_TIER_BYTES - 100;
    await createUsage({ userId, totalStorageBytes: nearLimit, storageLimitBytes: FREE_TIER_BYTES });

    await expect(
      incrementStorage(userId, 1_000, { contentType: "image/jpeg" })
    ).rejects.toThrow("QUOTA_EXCEEDED");

    // Usage must NOT have changed
    const usage = await Usage.findOne({ userId });
    expect(usage?.totalStorageBytes).toBe(nearLimit);
  });

  it("throws QUOTA_EXCEEDED when upload exactly matches remaining bytes + 1", async () => {
    const userId = makeUserId();
    await createUsage({ userId, totalStorageBytes: FREE_TIER_BYTES - 1, storageLimitBytes: FREE_TIER_BYTES });

    await expect(
      incrementStorage(userId, 2) // 1 byte over
    ).rejects.toThrow("QUOTA_EXCEEDED");
  });

  it("does NOT throw when upload exactly fills the remaining quota", async () => {
    const userId = makeUserId();
    await createUsage({ userId, totalStorageBytes: FREE_TIER_BYTES - 1000, storageLimitBytes: FREE_TIER_BYTES });

    await expect(
      incrementStorage(userId, 1000) // exactly fills
    ).resolves.not.toThrow();

    const usage = await Usage.findOne({ userId });
    expect(usage?.totalStorageBytes).toBe(FREE_TIER_BYTES);
  });

  it("downgrades expired pro plan inline before checking quota", async () => {
    const userId = makeUserId();
    // Pro plan expired, usage is 5GB (under free limit)
    await createUsage({
      userId,
      plan: "pro",
      totalStorageBytes: 5 * 1024 * 1024 * 1024,
      storageLimitBytes: PRO_100_BYTES,
      planExpiresAt: new Date(Date.now() - 1000),
      planPriceINR: 149,
    });

    // Upload 100MB — should succeed under free tier (5GB + 100MB < 10GB)
    await expect(
      incrementStorage(userId, 100 * 1024 * 1024)
    ).resolves.not.toThrow();

    const usage = await Usage.findOne({ userId });
    expect(usage?.plan).toBe("free");
    expect(usage?.storageLimitBytes).toBe(FREE_TIER_BYTES);
  });

  it("creates a new usage record on upsert if none exists", async () => {
    const userId = makeUserId();
    // No prior usage record
    await incrementStorage(userId, 500_000);
    const usage = await Usage.findOne({ userId });
    expect(usage).not.toBeNull();
    expect(usage?.totalStorageBytes).toBe(500_000);
  });
});
