import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";

import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import PhotoAlbum, { IPhotoAlbum } from "@/models/PhotoAlbum";
import StorageObject from "@/models/StorageObject";
import { ALBUM_OBJECTS_MAX_BATCH } from "@/lib/albums/constants";

export const dynamic = "force-dynamic";

/**
 * Idempotent create-or-find of a device-mirrored album keyed by sourceRef.
 *
 * Mobile backup clients derive sourceRef as an opaque keyed HMAC of the
 * device album identity. The server never learns album titles. Two devices
 * of the same user mirroring the same device album converge to one cloud
 * album. On the found path encryptedName is NOT overwritten, so a rename
 * done on the web wins over the device title.
 *
 * POST /api/albums/upsert
 *   { sourceRef: string, encryptedName: string, objectIds?: string[] }
 *   -> 201 { album, created: true }  (newly created)
 *   -> 200 { album, created: false } (already existed; objectIds $addToSet'ed)
 */

function normalizeObjectIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (id): id is string =>
          typeof id === "string" && Types.ObjectId.isValid(id),
      ),
    ),
  );
}

async function verifiedMediaIds(userId: string, objectIds: string[]) {
  if (objectIds.length === 0) return [];
  const objects = await StorageObject.find({
    _id: { $in: objectIds.map((id) => new Types.ObjectId(id)) },
    userId,
    mediaCategory: { $in: ["image", "video"] },
    deletedAt: { $exists: false },
    isSidecar: { $ne: true },
  })
    .select("_id")
    .lean<Array<{ _id: Types.ObjectId }>>();
  return objects.map((object) => object._id);
}

function serializeAlbum(album: IPhotoAlbum) {
  const objectIds = (album.objectIds ?? []).map(String);
  return {
    _id: String(album._id),
    encryptedName: album.encryptedName ?? null,
    sourceRef: album.sourceRef ?? null,
    slug: album.slug ?? String(album._id),
    description: album.description ?? "",
    objectIds,
    objectCount: objectIds.length,
    coverObjectId: album.coverObjectId ? String(album.coverObjectId) : null,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const body = await request.json().catch(() => ({}));

    const sourceRef =
      typeof body.sourceRef === "string" ? body.sourceRef.trim() : "";
    const encryptedName =
      typeof body.encryptedName === "string"
        ? body.encryptedName.trim().slice(0, 2048)
        : "";
    if (sourceRef.length < 16 || sourceRef.length > 128) {
      return NextResponse.json(
        { error: "sourceRef is required (16-128 chars)" },
        { status: 400 },
      );
    }
    if (!encryptedName) {
      return NextResponse.json(
        { error: "encryptedName is required" },
        { status: 400 },
      );
    }
    const requestedIds = normalizeObjectIds(body.objectIds);
    if (requestedIds.length > ALBUM_OBJECTS_MAX_BATCH) {
      return NextResponse.json(
        { error: `At most ${ALBUM_OBJECTS_MAX_BATCH} objects per request` },
        { status: 400 },
      );
    }

    await dbConnect();
    const userId = session.user.id;
    const verifiedIds = await verifiedMediaIds(userId, requestedIds);

    const attachAndReturn = async (album: IPhotoAlbum, created: boolean) => {
      if (verifiedIds.length > 0) {
        const updated = await PhotoAlbum.findOneAndUpdate(
          { _id: album._id, userId },
          { $addToSet: { objectIds: { $each: verifiedIds } } },
          { new: true },
        );
        if (updated) {
          if (!updated.coverObjectId && updated.objectIds.length > 0) {
            updated.coverObjectId = updated.objectIds[0];
            await updated.save();
          }
          album = updated;
        }
      }
      return NextResponse.json(
        { album: serializeAlbum(album), created },
        { status: created ? 201 : 200 },
      );
    };

    const existing = await PhotoAlbum.findOne({ userId, sourceRef });
    if (existing) {
      // Found path: never overwrite encryptedName; web renames win.
      return attachAndReturn(existing, false);
    }

    try {
      const albumId = new Types.ObjectId();
      const album = await PhotoAlbum.create({
        _id: albumId,
        userId,
        sourceRef,
        encryptedName,
        slug: String(albumId),
        objectIds: verifiedIds,
        coverObjectId: verifiedIds[0],
      });
      return NextResponse.json(
        { album: serializeAlbum(album), created: true },
        { status: 201 },
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const winner = await PhotoAlbum.findOne({ userId, sourceRef });
        if (winner) return attachAndReturn(winner, false);
      }
      throw error;
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
