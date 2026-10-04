import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { DriveUploadCommitError, createDriveFolder } from "@xenode/database";
import {
  bucketOwnershipClause,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { publishSyncEvent, toSyncObjectSnapshot } from "@/lib/realtime/publish";
import { binObjectsInSpace } from "@/lib/storage/bin-objects";
import {
  DRIVE_FOLDER_CONTENT_TYPE,
  folderListingId,
  spaceStorageRoot,
} from "@/lib/storage/folders";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown, fallback: string) {
  if (isAuthzError(error)) return toJsonResponse(error);
  if (error instanceof DriveUploadCommitError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  console.error(`[folders] ${fallback}`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/**
 * POST /api/objects/folder — create a folder record. Folders are metadata
 * with an encrypted display name; no blob is written and the key is an opaque
 * identity, never a name or path.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request, "manage");
    const { bucketId, encryptedDisplayName, parentFolderId, spaceKeyVersion } = await request.json();
    if (typeof bucketId !== "string" || !/^[a-f0-9]{24}$/iu.test(bucketId)) {
      return NextResponse.json({ error: "bucketId is required" }, { status: 400 });
    }
    await dbConnect();
    const bucket = await Bucket.findOne({ _id: bucketId, ...bucketOwnershipClause(ctx) })
      .select("_id")
      .lean<{ _id: Types.ObjectId }>();
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }
    const created = await createDriveFolder({
      spaceId: ctx.spaceId,
      bucketId: bucket._id,
      accountId: ctx.accountId,
      storageRoot: spaceStorageRoot(ctx),
      parentFolderId: parentFolderId ?? null,
      encryptedDisplayName,
      spaceKeyVersion,
    });
    const folder = StorageObject.hydrate(created);
    await publishSyncEvent({
      userId: ctx.userId,
      spaceId: ctx.spaceId,
      type: "FOLDER_CREATED",
      payload: {
        bucketId: String(bucket._id),
        objectId: String(folder._id),
        folderIds: [folderListingId(folder.folderId)],
        object: toSyncObjectSnapshot(folder),
      },
      invalidateFolders: [folder.folderId ?? null],
    });
    return NextResponse.json({ folder }, { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error, "Failed to create folder");
  }
}

/** DELETE /api/objects/folder — move a folder and its live subtree to the Bin. */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request, "delete");
    const { folderId } = await request.json();
    if (typeof folderId !== "string" || !/^[a-f0-9]{24}$/iu.test(folderId)) {
      return NextResponse.json({ error: "folderId is required" }, { status: 400 });
    }
    await dbConnect();
    const folder = await StorageObject.exists({
      _id: folderId,
      spaceId: ctx.spaceId,
      contentType: DRIVE_FOLDER_CONTENT_TYPE,
      deletedAt: null,
    });
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    const result = await binObjectsInSpace(ctx, [folderId]);
    return NextResponse.json({ success: true, deletedCount: result.binnedCount });
  } catch (error: unknown) {
    return errorResponse(error, "Failed to delete folder");
  }
}
