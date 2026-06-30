import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { snapshotCurrentAsVersion } from "@/lib/storage/versions";

describe("organization storage scope model fields", () => {
  it("defaults new bucket and object documents to personal scope", async () => {
    const bucket = await Bucket.create({
      userId: "user_1",
      name: "personal-drive",
      b2BucketId: "b2-personal",
      region: "us-west-004",
    });

    const object = await StorageObject.create({
      bucketId: bucket._id,
      userId: "user_1",
      key: "users/user_1/file",
      size: 123,
      contentType: "text/plain",
      mediaCategory: "document",
      b2FileId: "b2-file",
      isEncrypted: true,
      encryptedDEK: "wrapped-user-dek",
    });

    expect(bucket.ownerScope).toBe("personal");
    expect(object.ownerScope).toBe("personal");
    expect(object.orgId).toBeUndefined();
    expect(object.teamId).toBeUndefined();
  });

  it("persists org/team scope fields and space-key wrap metadata", async () => {
    const spaceKeyId = new mongoose.Types.ObjectId();
    const bucket = await Bucket.create({
      userId: "creator_1",
      ownerScope: "team",
      orgId: "org_1",
      teamId: "team_1",
      createdBy: "creator_1",
      name: "team-drive",
      b2BucketId: "b2-team",
      region: "us-west-004",
    });

    const object = await StorageObject.create({
      bucketId: bucket._id,
      userId: "creator_1",
      ownerScope: "team",
      orgId: "org_1",
      teamId: "team_1",
      createdBy: "creator_1",
      key: "teams/team_1/file",
      size: 456,
      contentType: "application/octet-stream",
      mediaCategory: "other",
      b2FileId: "b2-team-file",
      isEncrypted: true,
      encryptedDEK: "space-wrapped-file-dek",
      wrappedBy: "space",
      spaceKeyId,
      spaceKeyVersion: 3,
      spaceKeyWrapIv: "space-wrap-iv",
    });

    expect(bucket.ownerScope).toBe("team");
    expect(bucket.orgId).toBe("org_1");
    expect(bucket.teamId).toBe("team_1");
    expect(object.ownerScope).toBe("team");
    expect(object.orgId).toBe("org_1");
    expect(object.teamId).toBe("team_1");
    expect(object.wrappedBy).toBe("space");
    expect(object.spaceKeyId?.toString()).toBe(spaceKeyId.toString());
    expect(object.spaceKeyVersion).toBe(3);
  });

  it("preserves space-key metadata when snapshotting versions", async () => {
    const spaceKeyId = new mongoose.Types.ObjectId();
    const object = new StorageObject({
      bucketId: new mongoose.Types.ObjectId(),
      userId: "creator_1",
      ownerScope: "organization",
      orgId: "org_1",
      key: "orgs/org_1/file",
      size: 789,
      contentType: "application/octet-stream",
      mediaCategory: "other",
      b2FileId: "b2-org-file",
      isEncrypted: true,
      encryptedDEK: "space-wrapped-file-dek",
      wrappedBy: "space",
      spaceKeyId,
      spaceKeyVersion: 4,
      spaceKeyWrapIv: "space-wrap-iv",
      updatedAt: new Date(),
    });

    const version = snapshotCurrentAsVersion(object, "editor_1");

    expect(version.wrappedBy).toBe("space");
    expect(version.spaceKeyId?.toString()).toBe(spaceKeyId.toString());
    expect(version.spaceKeyVersion).toBe(4);
    expect(version.spaceKeyWrapIv).toBe("space-wrap-iv");
    expect(version.createdBy).toBe("editor_1");
  });
});
