import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as commentsGET, POST as commentsPOST } from "@/app/api/objects/[id]/comments/route";
import { PATCH as commentPATCH } from "@/app/api/objects/[id]/comments/[commentId]/route";
import { getServerSession } from "@/lib/auth/session";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import DirectShare from "@/models/DirectShare";
import FileComment from "@/models/FileComment";
import mongoose from "mongoose";

const mockedGetServerSession = vi.mocked(getServerSession);

function mockSession(userId: string) {
  mockedGetServerSession.mockResolvedValue({
    user: { id: userId, email: `${userId}@e.com`, name: userId, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
    session: { id: `s-${userId}`, userId, token: `t-${userId}`, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
  } as unknown as Awaited<ReturnType<typeof getServerSession>>);
}

async function makeObject() {
  const bucket = await Bucket.findOneAndUpdate(
    { systemKey: "drive" },
    { $setOnInsert: { systemKey: "drive", name: "drive", b2BucketId: "b2-drive" } },
    { upsert: true, new: true },
  );
  return StorageObject.create({
    bucketId: bucket!._id,
    spaceId: "space_personal_owner_1",
    createdByAccountId: "owner_1",
    key: `users/owner_1/${new mongoose.Types.ObjectId().toHexString()}.bin`,
    size: 100,
    contentType: "text/plain",
    mediaCategory: "document",
    b2FileId: "f",
    isEncrypted: true,
    encryptedDEK: "wrapped",
  });
}

async function makeShare(
  objId: mongoose.Types.ObjectId,
  bucketId: mongoose.Types.ObjectId,
  role: "viewer" | "commenter" | "editor" = "viewer",
) {
  return DirectShare.create({
    objectId: objId,
    bucketId,
    createdBy: "owner_1",
    shareEncryptedDEK: "dek",
    shareKeyIv: "iv",
    recipients: [
      { recipientUserId: "member_1", recipientEmail: "member_1@e.com", wrappedShareKey: "k", accessType: role, downloadCount: 0 },
    ],
    isRevoked: false,
  });
}

function objParams(id: string) {
  return { params: Promise.resolve({ id }) };
}
function patchParams(id: string, commentId: string) {
  return { params: Promise.resolve({ id, commentId }) };
}
function postReq(payload: unknown) {
  return new NextRequest("http://localhost/c", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  });
}
function patchReq(payload: unknown) {
  return new NextRequest("http://localhost/c", {
    method: "PATCH",
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  });
}
function getReq() {
  return new NextRequest("http://localhost/c");
}

describe("object-centric E2EE comments", () => {
  afterEach(() => {
    mockedGetServerSession.mockReset();
  });

  it("lets the owner post and read without any share", async () => {
    const obj = await makeObject();
    mockSession("owner_1");

    const posted = await commentsPOST(postReq({ ciphertext: "cipher-1" }), objParams(String(obj._id)));
    expect(posted.status).toBe(200);

    const res = await commentsGET(getReq(), objParams(String(obj._id)));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.canComment).toBe(true);
    expect(data.via).toBe("workspace");
    expect(data.comments).toHaveLength(1);
    expect(data.comments[0].mine).toBe(true);
  });

  it("lets a share recipient read, but viewers cannot post", async () => {
    const obj = await makeObject();
    await makeShare(obj._id, obj.bucketId, "viewer");
    mockSession("member_1");

    const res = await commentsGET(getReq(), objParams(String(obj._id)));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.via).toBe("share");
    expect(data.canComment).toBe(false);

    const denied = await commentsPOST(postReq({ ciphertext: "x" }), objParams(String(obj._id)));
    const deniedData = await denied.json();
    expect(denied.status).toBe(403);
    expect(deniedData.code).toBe("comment_forbidden");
  });

  it("lets a commenter post threads and replies (replies attach to the root)", async () => {
    const obj = await makeObject();
    await makeShare(obj._id, obj.bucketId, "commenter");
    mockSession("member_1");

    const rootRes = await commentsPOST(postReq({ ciphertext: "root" }), objParams(String(obj._id)));
    const root = (await rootRes.json()).comment;
    expect(rootRes.status).toBe(200);
    expect(root.parentId).toBeNull();

    const replyRes = await commentsPOST(
      postReq({ ciphertext: "reply", parentId: root.id }),
      objParams(String(obj._id)),
    );
    const reply = (await replyRes.json()).comment;
    expect(reply.parentId).toBe(root.id);

    // Replying to a reply still attaches to the thread root.
    const nestedRes = await commentsPOST(
      postReq({ ciphertext: "nested", parentId: reply.id }),
      objParams(String(obj._id)),
    );
    const nested = (await nestedRes.json()).comment;
    expect(nested.parentId).toBe(root.id);
  });

  it("rejects a parent comment from a different object", async () => {
    const objA = await makeObject();
    const objB = await makeObject();
    mockSession("owner_1");
    const rootRes = await commentsPOST(postReq({ ciphertext: "root" }), objParams(String(objA._id)));
    const root = (await rootRes.json()).comment;

    const res = await commentsPOST(
      postReq({ ciphertext: "cross", parentId: root.id }),
      objParams(String(objB._id)),
    );
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.code).toBe("invalid_parent");
  });

  it("denies strangers entirely", async () => {
    const obj = await makeObject();
    await makeShare(obj._id, obj.bucketId, "editor");
    mockSession("stranger_1");

    expect((await commentsGET(getReq(), objParams(String(obj._id)))).status).toBe(404);
    expect((await commentsPOST(postReq({ ciphertext: "x" }), objParams(String(obj._id)))).status).toBe(404);
  });

  it("resolve/reopen flips thread status; viewers cannot resolve; replies cannot be resolved", async () => {
    const obj = await makeObject();
    const share = await makeShare(obj._id, obj.bucketId, "commenter");
    mockSession("member_1");
    const root = (await (await commentsPOST(postReq({ ciphertext: "root" }), objParams(String(obj._id)))).json()).comment;
    const reply = (await (await commentsPOST(postReq({ ciphertext: "r", parentId: root.id }), objParams(String(obj._id)))).json()).comment;

    const resolved = await commentPATCH(patchReq({ action: "resolve" }), patchParams(String(obj._id), root.id));
    const resolvedData = await resolved.json();
    expect(resolved.status).toBe(200);
    expect(resolvedData.comment.status).toBe("resolved");
    expect(resolvedData.comment.resolvedBy).toBe("member_1");

    const replyPatch = await commentPATCH(patchReq({ action: "resolve" }), patchParams(String(obj._id), reply.id));
    expect(replyPatch.status).toBe(400);

    const reopened = await commentPATCH(patchReq({ action: "reopen" }), patchParams(String(obj._id), root.id));
    expect((await reopened.json()).comment.status).toBe("open");

    // Downgrade to viewer → resolve now forbidden.
    await DirectShare.updateOne(
      { _id: share._id },
      { $set: { "recipients.0.accessType": "viewer" } },
    );
    const denied = await commentPATCH(patchReq({ action: "resolve" }), patchParams(String(obj._id), root.id));
    expect(denied.status).toBe(403);

    expect(await FileComment.countDocuments({ objectId: obj._id })).toBe(2);
  });
});
