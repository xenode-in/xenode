import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";

import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import PhotoAlbum from "@/models/PhotoAlbum";
import StorageObject from "@/models/StorageObject";
import { albumIdentifierFilter } from "@/lib/albums/slug";

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

async function verifiedImageIds(userId: string, objectIds: string[]) {
  if (objectIds.length === 0) return [];
  const objects = await StorageObject.find({
    _id: { $in: objectIds.map((id) => new Types.ObjectId(id)) },
    userId,
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
    const session = await requireAuth(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    await dbConnect();

    const verifiedIds = await verifiedImageIds(
      session.user.id,
      normalizeObjectIds(body.objectIds),
    );

    if (verifiedIds.length === 0) {
      return NextResponse.json({ error: "No valid images were provided" }, { status: 400 });
    }

    const album = await PhotoAlbum.findOneAndUpdate(
      albumIdentifierFilter(session.user.id, id),
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
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const idsToRemove = normalizeObjectIds(body.objectIds);

    if (idsToRemove.length === 0) {
      return NextResponse.json({ error: "No images were provided" }, { status: 400 });
    }

    await dbConnect();

    const album = await PhotoAlbum.findOne(
      albumIdentifierFilter(session.user.id, id),
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

    return NextResponse.json({ album: serializeAlbum(album.toObject()) });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
