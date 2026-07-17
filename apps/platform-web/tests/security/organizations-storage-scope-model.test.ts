import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { snapshotCurrentAsVersion } from "@/lib/storage/versions";

describe("organization storage scope model fields", () => {
  it("scopes personal objects by their personal space id", async () => {
    const bucket = await Bucket.create({
      systemKey: "drive",
      name: "xenode-drive-storage",
      b2BucketId: "xenode-drive-storage",
      region: "us-west-004",
    });

    await StorageObject.create({
      bucketId: bucket._id,
      spaceId: "space_personal_user_1",
      createdByAccountId: "user_1",
      key: "users/user_1/file",
      size: 123,
      contentType: "text/plain",
      mediaCategory: "document",
      b2FileId: "b2-file",
      isEncrypted: true,
      encryptedDEK: "wrapped-user-dek",
    });

    const object = await StorageObject.findOne({
      spaceId: "space_personal_user_1",
      key: "users/user_1/file",
    }).lean();

    expect(object).not.toBeNull();
    expect(object?.spaceId).toBe("space_personal_user_1");
    expect(object?.createdByAccountId).toBe("user_1");
  });

  it("persists team space id and space-key wrap metadata", async () => {
    const spaceKeyId = new mongoose.Types.ObjectId();
    const bucket = await Bucket.create({
      systemKey: "drive",
      name: "xenode-drive-storage",
      b2BucketId: "xenode-drive-storage",
      region: "us-west-004",
    });

    await StorageObject.create({
      bucketId: bucket._id,
      spaceId: "space_team_org_1_team_1",
      createdByAccountId: "org:org_1",
      key: "workspaces/org_1/teams/team_1/objects/file",
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

    const object = await StorageObject.findOne({
      spaceId: "space_team_org_1_team_1",
    }).lean();

    expect(object).not.toBeNull();
    expect(object?.spaceId).toBe("space_team_org_1_team_1");
    expect(object?.createdByAccountId).toBe("org:org_1");
    expect(object?.wrappedBy).toBe("space");
    expect(object?.spaceKeyId?.toString()).toBe(spaceKeyId.toString());
    expect(object?.spaceKeyVersion).toBe(3);
    expect(object?.spaceKeyWrapIv).toBe("space-wrap-iv");
  });

  it("preserves space-key metadata when snapshotting versions", async () => {
    const spaceKeyId = new mongoose.Types.ObjectId();
    const object = new StorageObject({
      bucketId: new mongoose.Types.ObjectId(),
      spaceId: "space_org_org_1",
      createdByAccountId: "creator_1",
      key: "workspaces/org_1/objects/file",
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
