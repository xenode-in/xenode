import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { uploadObject } from "@/lib/b2/objects";
import ShareLink from "@/models/ShareLink";
import DirectShare from "@/models/DirectShare";
import {
  parentPrefixForKey,
  publishSyncEvent,
  toSyncObjectSnapshot,
} from "@/lib/realtime/publish";

export const dynamic = "force-dynamic";

/** POST /api/objects/folder - Create a new folder */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    const userId = ctx.userId;
    const body = await request.json();
    const { bucketId, name, encryptedDisplayName, prefix = "" } = body;

    if (!bucketId || !name) {
      return NextResponse.json({ error: "Bucket ID and folder name are required" }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9\-_ ]+$/.test(name)) {
      return NextResponse.json({ error: "Folder name contains invalid characters" }, { status: 400 });
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      ...bucketOwnershipClause(ctx),
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    if (bucket.userId === "system" && !prefix.startsWith(`users/${userId}/`)) {
      return NextResponse.json({ error: "Access denied to this folder" }, { status: 403 });
    }

    const fullKey = `${prefix}${name}/`;
    const b2BucketName = bucket.b2BucketId;

    const existing = await StorageObject.findOne({ bucketId, key: fullKey });
    if (existing) {
      return NextResponse.json({ error: "Folder already exists" }, { status: 409 });
    }

    const uploadResult = await uploadObject(b2BucketName, fullKey, Buffer.from(""), "application/x-directory", 0);

    const folder = await StorageObject.create({
      bucketId: bucket._id,
      userId,
      ownerScope: "personal",
      createdBy: userId,
      key: fullKey,
      size: 0,
      contentType: "application/x-directory",
      encryptedDisplayName,
      b2FileId: uploadResult.b2FileId,
    });

    await Bucket.updateOne({ _id: bucket._id }, { $inc: { objectCount: 1 } });

    await publishSyncEvent({
      userId,
      type: "FOLDER_CREATED",
      payload: {
        bucketId: bucket._id.toString(),
        key: fullKey,
        parentPrefix: prefix,
        object: toSyncObjectSnapshot(folder),
      },
      invalidatePrefixes: [prefix],
    });

    return NextResponse.json({ folder }, { status: 201 });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    return NextResponse.json({ error: "Failed to create folder" }, { status: 500 });
  }
}

/** DELETE /api/objects/folder - Recursively delete a folder and its contents */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    const userId = ctx.userId;
    const body = await request.json();
    const { bucketId, prefix } = body;

    if (!bucketId || !prefix) {
      return NextResponse.json({ error: "Bucket ID and prefix are required" }, { status: 400 });
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      ...bucketOwnershipClause(ctx),
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    if (bucket.userId === "system" && !prefix.startsWith(`users/${userId}/`)) {
      return NextResponse.json({ error: "Access denied to this folder" }, { status: 403 });
    }

    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const objects = await StorageObject.find({ bucketId, key: { $regex: `^${escapedPrefix}` } });

    const deletedObjectIds: string[] = [];
    const now = new Date();

    for (const obj of objects) {
      await StorageObject.findByIdAndUpdate(obj._id, {
        $set: { deletedAt: now }
      });
      deletedObjectIds.push(obj._id.toString());
    }

    if (deletedObjectIds.length > 0) {
      await ShareLink.deleteMany({ objectId: { $in: deletedObjectIds } });
      await DirectShare.deleteMany({ objectId: { $in: deletedObjectIds } });
    }

    await publishSyncEvent({
      userId,
      type: "FOLDER_DELETED",
      payload: {
        bucketId: bucket._id.toString(),
        objectIds: deletedObjectIds,
        key: prefix,
        keys: objects.map((object) => object.key),
        parentPrefix: parentPrefixForKey(prefix),
      },
      invalidatePrefixes: [parentPrefixForKey(prefix), prefix],
      invalidateRecent: true,
    });

    return NextResponse.json({ success: true, deletedCount: deletedObjectIds.length });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    return NextResponse.json({ error: "Failed to delete folder" }, { status: 500 });
  }
}
