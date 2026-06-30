import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";

import {
  type AccessContext,
  isAuthzError,
  objectOwnershipClause,
  ownerClause,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import PhotoAlbum from "@/models/PhotoAlbum";
import StorageObject from "@/models/StorageObject";
import AlbumShareLink from "@/models/AlbumShareLink";
import { albumIdentifierFilter } from "@/lib/albums/slug";
import { deleteAlbumShareThumbnails } from "@/lib/albums/cleanup";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

type AlbumDoc = {
  _id: Types.ObjectId;
  slug?: string;
  objectIds?: Types.ObjectId[];
  coverObjectId?: Types.ObjectId;
};

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

async function verifiedImageIds(ctx: AccessContext, objectIds: string[]) {
  if (objectIds.length === 0) return [];
  const objects = await StorageObject.find({
    _id: { $in: objectIds.map((id) => new Types.ObjectId(id)) },
    ...objectOwnershipClause(ctx),
    mediaCategory: "image",
    deletedAt: { $exists: false },
    isSidecar: { $ne: true },
  })
    .select("_id")
    .lean<Array<{ _id: Types.ObjectId }>>();
  return objects.map((object) => object._id);
}

function serializeAlbum(album: AlbumDoc) {
  const objectIds = (album.objectIds ?? []).map(String);
  return {
    ...album,
    _id: String(album._id),
    slug: album.slug ?? String(album._id),
    objectIds,
    objectCount: objectIds.length,
    coverObjectId: album.coverObjectId ? String(album.coverObjectId) : null,
  };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    ownerClause(ctx);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    await dbConnect();

    const verifiedIds = await verifiedImageIds(
      ctx,
      normalizeObjectIds(body.objectIds),
    );

    if (verifiedIds.length === 0) {
      return NextResponse.json({ error: "No valid images were provided" }, { status: 400 });
    }

    const album = await PhotoAlbum.findOneAndUpdate(
      albumIdentifierFilter(ctx.userId, id),
      {
        $addToSet: { objectIds: { $each: verifiedIds } },
        $setOnInsert: { coverObjectId: verifiedIds[0] },
      },
      { new: true },
    );

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    if (!album.coverObjectId) {
      album.coverObjectId = album.objectIds[0];
      await album.save();
    }

    return NextResponse.json({ album: serializeAlbum(album.toObject()) });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    ownerClause(ctx);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const idsToRemove = normalizeObjectIds(body.objectIds);

    if (idsToRemove.length === 0) {
      return NextResponse.json({ error: "No images were provided" }, { status: 400 });
    }

    await dbConnect();

    const album = await PhotoAlbum.findOne(
      albumIdentifierFilter(ctx.userId, id),
    );

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    const removeSet = new Set(idsToRemove);
    album.objectIds = album.objectIds.filter(
      (objectId) => !removeSet.has(String(objectId)),
    );
    if (
      album.coverObjectId &&
      removeSet.has(String(album.coverObjectId))
    ) {
      album.coverObjectId = album.objectIds[0];
    }
    await album.save();

    const removedObjectIds = idsToRemove.map((value) => new Types.ObjectId(value));
    const affectedLinks = await AlbumShareLink.find({
      albumId: album._id,
      createdBy: ctx.userId,
      "items.objectId": { $in: removedObjectIds },
    })
      .select("items")
      .lean();
    const removedSet = new Set(idsToRemove);
    const removedItems = affectedLinks
      .flatMap((link) => link.items)
      .filter((item) => removedSet.has(String(item.objectId)));
    await deleteAlbumShareThumbnails(ctx.userId, removedItems);
    await AlbumShareLink.updateMany(
      {
        albumId: album._id,
        createdBy: ctx.userId,
        "items.objectId": { $in: removedObjectIds },
      },
      { $pull: { items: { objectId: { $in: removedObjectIds } } } },
    );
    await AlbumShareLink.updateMany(
      {
        albumId: album._id,
        createdBy: ctx.userId,
        isRevoked: false,
        items: { $size: 0 },
      },
      { $set: { isRevoked: true } },
    );

    return NextResponse.json({ album: serializeAlbum(album.toObject()) });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
