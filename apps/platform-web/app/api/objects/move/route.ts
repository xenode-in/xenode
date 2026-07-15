import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  isAuthzError,
  objectOwnershipClause,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import {
  copyObject,
  deleteObject as deleteB2Object,
} from "@/lib/b2/objects";
import {
  parentPrefixForKey,
  publishSyncEvent,
  toSyncObjectSnapshot,
} from "@/lib/realtime/publish";
import { orgObjectKeyPrefix, teamObjectKeyPrefix } from "@/lib/orgs/storage";

export const dynamic = "force-dynamic";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function canManageInScope(ctx: Awaited<ReturnType<typeof requireAccessContext>>): boolean {
  if (ctx.spaceType === "personal") return true;
  return (
    ctx.role === "owner" ||
    ctx.role === "admin"
  );
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    const userId = ctx.userId;
    const { bucketId, sourceKeys, destinationPrefix } = await request.json();

    if (
      !bucketId ||
      !Array.isArray(sourceKeys) ||
      sourceKeys.length === 0 ||
      typeof destinationPrefix !== "string"
    ) {
      return NextResponse.json(
        { error: "Invalid request parameters" },
        { status: 400 },
      );
    }

    if (!canManageInScope(ctx)) {
      return NextResponse.json(
        { error: "Forbidden", code: "workspace_manage_role_required" },
        { status: 403 },
      );
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      ...bucketOwnershipClause(ctx),
    });
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    const allowedPrefix =
      ctx.spaceType === "organization"
        ? orgObjectKeyPrefix(ctx.organizationId!)
        : ctx.spaceType === "team"
          ? teamObjectKeyPrefix(ctx.organizationId!, ctx.teamId!)
        : `users/${userId}/`;

    if (
      bucket.systemKey === "drive" &&
      !destinationPrefix.startsWith(allowedPrefix)
    ) {
      return NextResponse.json(
        { error: "Access denied to destination" },
        { status: 403 },
      );
    }

    const b2BucketName = bucket.b2BucketId;
    const movedObjects = [];
    const movedFromKeys: string[] = [];
    const errors: { key: string; error: string }[] = [];

    const moveOne = async (
      object: InstanceType<typeof StorageObject>,
      newKey: string,
    ) => {
      const oldKey = object.key;
      if (oldKey === newKey) return object;

      const conflict = await StorageObject.exists({
        bucketId: bucket._id,
        key: newKey,
        _id: { $ne: object._id },
      });
      if (conflict) {
        throw new Error("An item with the same name already exists there");
      }

      // Chunked files have no single blob at object.key; their physical blobs
      // are referenced by chunks[]. Moving them is a logical path update only.
      const hasChunkBlobs = Array.isArray(object.chunks) && object.chunks.length > 0;
      let copiedPrimaryBlob = false;

      if (!hasChunkBlobs) {
        await copyObject(b2BucketName, oldKey, b2BucketName, newKey);
        copiedPrimaryBlob = true;
      }

      try {
        // Preserve the document ID instead of inserting a duplicate. This is
        // required for unique sync fingerprints and keeps shares/references.
        object.key = newKey;
        object.updatedAt = new Date();
        await object.save();
      } catch (databaseError) {
        if (copiedPrimaryBlob) {
          await deleteB2Object(b2BucketName, newKey).catch(() => {});
        }
        throw databaseError;
      }

      if (copiedPrimaryBlob) {
        // The move is already committed in Mongo. A failed cleanup only leaves
        // an inaccessible orphan, so report it without reverting a valid move.
        await deleteB2Object(b2BucketName, oldKey).catch((cleanupError) => {
          console.error("[move] Failed to remove old B2 object", {
            oldKey,
            newKey,
            error: errorMessage(cleanupError),
          });
        });
      }

      movedFromKeys.push(oldKey);
      return object;
    };

    for (const sourceKey of Array.from(new Set(sourceKeys.map(String)))) {
      if (
        bucket.systemKey === "drive" &&
        !sourceKey.startsWith(allowedPrefix)
      ) {
        errors.push({ key: sourceKey, error: "Access denied to source" });
        continue;
      }

      const isFolder = sourceKey.endsWith("/");
      const sourceName = sourceKey.split("/").filter(Boolean).pop();
      if (!sourceName) {
        errors.push({ key: sourceKey, error: "Invalid source key" });
        continue;
      }

      try {
        if (isFolder) {
          if (destinationPrefix.startsWith(sourceKey)) {
            throw new Error("A folder cannot be moved inside itself");
          }

          const objectsToMove = await StorageObject.find({
            bucketId: bucket._id,
            ...objectOwnershipClause(ctx),
            key: { $regex: `^${escapeRegex(sourceKey)}` },
          }).sort({ key: 1 });

          if (objectsToMove.length === 0) {
            throw new Error("Folder not found");
          }

          for (const object of objectsToMove) {
            const relativePath = object.key.slice(sourceKey.length);
            const newKey = `${destinationPrefix}${sourceName}/${relativePath}`;
            try {
              movedObjects.push(await moveOne(object, newKey));
            } catch (objectError) {
              errors.push({
                key: object.key,
                error: errorMessage(objectError),
              });
            }
          }
        } else {
          const object = await StorageObject.findOne({
            bucketId: bucket._id,
            ...objectOwnershipClause(ctx),
            key: sourceKey,
          });
          if (!object) throw new Error("File not found");

          const newKey = `${destinationPrefix}${sourceName}`;
          movedObjects.push(await moveOne(object, newKey));
        }
      } catch (moveError) {
        console.error("[move] Failed", {
          sourceKey,
          destinationPrefix,
          error: moveError,
        });
        errors.push({ key: sourceKey, error: errorMessage(moveError) });
      }
    }

    if (movedObjects.length > 0) {
      const affectedPrefixes = Array.from(
        new Set([
          destinationPrefix,
          ...movedFromKeys.map(parentPrefixForKey),
        ]),
      );
      await publishSyncEvent({
        userId,
        spaceId: ctx.spaceId,
        type: "FILE_MOVED",
        payload: {
          bucketId: bucket._id.toString(),
          keys: movedFromKeys,
          destinationPrefix,
          affectedPrefixes,
          objects: movedObjects.map(toSyncObjectSnapshot),
        },
        invalidatePrefixes: affectedPrefixes,
        invalidateRecent: true,
      });
    }

    return NextResponse.json({
      moved: movedObjects.length,
      movedObjects,
      errors,
    });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: errorMessage(error) || "Failed to move objects" },
      { status: 500 },
    );
  }
}
