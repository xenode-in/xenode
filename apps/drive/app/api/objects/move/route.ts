import { NextRequest, NextResponse } from "next/server";
import { DriveUploadCommitError, moveDriveObjects } from "@xenode/database";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import StorageObject from "@/models/StorageObject";
import { publishSyncEvent } from "@/lib/realtime/publish";
import { folderListingId } from "@/lib/storage/folders";

export const dynamic = "force-dynamic";

/**
 * POST /api/objects/move — `{ objectIds, destinationFolderId }` (null for the
 * Space root). A move changes folder metadata only: physical keys, chunks,
 * version snapshots and outstanding signed URLs are untouched.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request, "manage");
    const { objectIds, destinationFolderId } = await request.json();
    if (destinationFolderId !== null && typeof destinationFolderId !== "string") {
      return NextResponse.json(
        { error: "destinationFolderId must be a folder id or null" },
        { status: 400 },
      );
    }
    await dbConnect();
    const before = Array.isArray(objectIds)
      ? await StorageObject.find({ _id: { $in: objectIds.filter((id) => typeof id === "string" && /^[a-f0-9]{24}$/iu.test(id)) }, spaceId: ctx.spaceId })
          .select("_id folderId")
          .lean<Array<{ _id: unknown; folderId?: unknown }>>()
      : [];
    const result = await moveDriveObjects({
      spaceId: ctx.spaceId,
      objectIds,
      destinationFolderId,
    });
    const sourceFolders = before.map((object) => folderListingId(object.folderId as string | null));
    await publishSyncEvent({
      userId: ctx.userId,
      spaceId: ctx.spaceId,
      type: "FILE_MOVED",
      payload: {
        objectIds: result.movedIds.map(String),
        folderIds: [...new Set([...sourceFolders, folderListingId(result.destination.folderId)])],
        destinationFolderId: result.destination.folderId ? String(result.destination.folderId) : null,
      },
      invalidateFolders: [
        ...before.map((object) => (object.folderId ? String(object.folderId) : null)),
        result.destination.folderId,
      ],
      invalidateRecent: true,
    });
    return NextResponse.json({
      success: true,
      movedIds: result.movedIds.map(String),
      destinationFolderId: result.destination.folderId ? String(result.destination.folderId) : null,
    });
  } catch (error: unknown) {
    if (isAuthzError(error)) return toJsonResponse(error);
    if (error instanceof DriveUploadCommitError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    console.error("[move] Failed", error);
    return NextResponse.json({ error: "Failed to move items" }, { status: 500 });
  }
}
