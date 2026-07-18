import { describe, expect, it } from "vitest";
import { getOrgHomeSummary } from "@/lib/orgs/home";
import OrgUsage from "@/models/OrgUsage";
import ActivityLog from "@/models/ActivityLog";
import AccessRequest from "@/models/AccessRequest";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import mongoose from "mongoose";

async function addMember(userId: string, role = "member", orgId = "org_1") {
  await mongoose.connection.collection("member").insertOne({
    id: `mem_${orgId}_${userId}`,
    userId,
    organizationId: orgId,
    role,
    createdAt: new Date(),
  });
}

describe("getOrgHomeSummary", () => {
  it("aggregates billing-safe org home data without leaking crypto/plaintext", async () => {
    await OrgUsage.create({
      orgId: "org_1",
      seats: 10,
      seatsUsed: 3,
      totalStorageBytes: 2048,
      storageLimitBytes: 1024 * 1024,
    });
    await addMember("owner_1", "owner");
    await addMember("member_2", "member");
    await ActivityLog.create({ orgId: "org_1", action: "member.joined", actorUserId: "member_2" });
    await AccessRequest.create({
      orgId: "org_1",
      requesterUserId: "member_2",
      resourceType: "object",
      status: "pending",
    });

    const bucket = await Bucket.findOneAndUpdate(
      { systemKey: "drive" },
      { $setOnInsert: { systemKey: "drive", name: "xenode-drive-storage", b2BucketId: "xenode-drive-storage" } },
      { upsert: true, new: true },
    );
    await StorageObject.create({
      bucketId: bucket!._id,
      spaceId: "space_org_org_1",
      createdByAccountId: "owner_1",
      key: "workspaces/org_1/objects/secret.bin",
      encryptedName: "ENCRYPTED_NAME_SHOULD_NOT_LEAK",
      size: 500,
      contentType: "application/octet-stream",
      mediaCategory: "other",
      b2FileId: "f1",
      isEncrypted: true,
      encryptedDEK: "wrapped",
      wrappedBy: "space",
      spaceKeyVersion: 1,
    });

    const summary = await getOrgHomeSummary({ orgId: "org_1" });

    expect(summary.storage).toEqual({ usedBytes: 2048, limitBytes: 1024 * 1024 });
    expect(summary.seats).toEqual({ used: 3, total: 10 });
    expect(summary.memberCount).toBe(2);
    expect(summary.pendingRequests).toBe(1);
    expect(summary.fileCount).toBe(1);
    expect(summary.recentActivity).toHaveLength(1);
    expect(summary.recentActivity[0].action).toBe("member.joined");
    expect(summary.recentFiles).toHaveLength(1);
    expect(summary.recentFiles[0].size).toBe(500);

    // No plaintext name / key / DEK anywhere in the serialized summary.
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("ENCRYPTED_NAME_SHOULD_NOT_LEAK");
    expect(serialized).not.toContain("secret.bin");
    expect(serialized).not.toContain("wrapped");
  });

  it("returns free-tier defaults when no OrgUsage row exists yet", async () => {
    const summary = await getOrgHomeSummary({ orgId: "org_empty" });
    expect(summary.storage.usedBytes).toBe(0);
    expect(summary.storage.limitBytes).toBe(5 * 1024 * 1024 * 1024);
    expect(summary.seats.total).toBe(3);
    expect(summary.memberCount).toBe(0);
    expect(summary.recentActivity).toHaveLength(0);
  });
});
