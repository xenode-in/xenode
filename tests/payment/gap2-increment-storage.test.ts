/**
 * GAP-2: incrementStorage Quota Ceiling
 *
 * Tests that incrementStorage throws QUOTA_EXCEEDED when the new
 * upload would push totalStorageBytes over storageLimitBytes.
 */
import { describe, it, expect } from "vitest";
import { incrementStorage } from "@/lib/metering/usage";
import Usage, { FREE_TIER_LIMIT_BYTES } from "@/models/Usage";
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
    // Pro plan expired with low usage so the upload fits within the production
    // free tier limit (FREE_TIER_LIMIT_BYTES = 5 GB) after the inline downgrade.
    await createUsage({
      userId,
      plan: "pro",
      totalStorageBytes: 1 * 1024 * 1024 * 1024, // 1 GB used
      storageLimitBytes: PRO_100_BYTES,
      planExpiresAt: new Date(Date.now() - 1000),
      planPriceINR: 149,
    });

    // Upload 100MB — succeeds under the free tier (1GB + 100MB << 5GB)
    await expect(
      incrementStorage(userId, 100 * 1024 * 1024)
    ).resolves.not.toThrow();

    const usage = await Usage.findOne({ userId });
    expect(usage?.plan).toBe("free");
    // The cron writes the production constant (5 GB), not the factory's 10 GB
    expect(usage?.storageLimitBytes).toBe(FREE_TIER_LIMIT_BYTES);
  });

  it("creates a new usage record on upsert if none exists", async () => {
    const userId = makeUserId();
    // No prior usage record
    await incrementStorage(userId, 500_000);
    const usage = await Usage.findOne({ userId });
    expect(usage).not.toBeNull();
    expect(usage?.totalStorageBytes).toBe(500_000);
  });

  it("atomically rejects concurrent uploads that would exceed quota", async () => {
    const userId = makeUserId();
    await createUsage({
      userId,
      totalStorageBytes: 0,
      storageLimitBytes: 1_000,
    });

    const results = await Promise.allSettled([
      incrementStorage(userId, 600),
      incrementStorage(userId, 600),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const usage = await Usage.findOne({ userId });
    expect(usage?.totalStorageBytes).toBe(600);
    expect(usage?.totalObjects).toBe(1);
  });
});
