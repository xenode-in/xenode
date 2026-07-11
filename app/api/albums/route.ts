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

export const dynamic = "force-dynamic";

const COVER_PROJECTION =
  "_id key size thumbnail aspectRatio isEncrypted encryptedName encryptedDisplayName createdAt";

type AlbumDoc = {
  _id: Types.ObjectId;
  slug?: string;
  description?: string;
  encryptedName?: string | null;
  sourceRef?: string | null;
  objectIds?: Types.ObjectId[];
  coverObjectId?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

type CoverDoc = {
  _id: Types.ObjectId;
  key: string;
  size?: number;
  thumbnail?: string;
  aspectRatio?: number;
  isEncrypted?: boolean;
  encryptedName?: string | null;
  encryptedDisplayName?: string | null;
  createdAt?: Date;
};

function normalizeEncryptedName(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 2048) : "";
}

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

// Albums hold photos AND videos; documents/audio/etc. stay excluded.
async function verifiedMediaIds(ctx: AccessContext, objectIds: string[]) {
  if (objectIds.length === 0) return [];
  const objects = await StorageObject.find({
    _id: { $in: objectIds.map((id) => new Types.ObjectId(id)) },
    ...objectOwnershipClause(ctx),
    mediaCategory: { $in: ["image", "video"] },
    deletedAt: { $exists: false },
    isSidecar: { $ne: true },
  })
    .select("_id")
    .lean<Array<{ _id: Types.ObjectId }>>();
  return objects.map((object) => object._id);
}

async function serializeAlbums(ctx: AccessContext, albums: AlbumDoc[]) {
  const coverIds = albums
    .map((album) => album.coverObjectId ?? album.objectIds?.[0])
    .filter((id): id is Types.ObjectId => !!id);

  const covers = coverIds.length
    ? await StorageObject.find({
        _id: { $in: coverIds },
        ...objectOwnershipClause(ctx),
      })
        .select(COVER_PROJECTION)
        .lean<CoverDoc[]>()
    : [];
  const coverById = new Map(covers.map((cover) => [String(cover._id), cover]));

  return albums.map((album) => {
    const ids = (album.objectIds ?? []).map((id: Types.ObjectId) => String(id));
    const coverId = String(album.coverObjectId ?? album.objectIds?.[0] ?? "");
    const cover = coverById.get(coverId);
    return {
      _id: String(album._id),
      encryptedName: album.encryptedName ?? null,
      sourceRef: album.sourceRef ?? null,
      slug: album.slug ?? String(album._id),
      description: album.description ?? "",
      objectIds: ids,
      objectCount: ids.length,
      coverObject: cover ? { ...cover, _id: String(cover._id) } : null,
      createdAt: album.createdAt,
      updatedAt: album.updatedAt,
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    await dbConnect();

    const albums = await PhotoAlbum.find(ownerClause(ctx))
      .sort({ updatedAt: -1 })
      .lean<AlbumDoc[]>();

    return NextResponse.json({ albums: await serializeAlbums(ctx, albums) });
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

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    const body = await request.json().catch(() => ({}));
    const encryptedName = normalizeEncryptedName(body.encryptedName);
    if (!encryptedName) {
      return NextResponse.json(
        { error: "encryptedName is required" },
        { status: 400 },
      );
    }

    await dbConnect();

    const objectIds = await verifiedMediaIds(
      ctx,
      normalizeObjectIds(body.objectIds),
    );
    const albumId = new Types.ObjectId();

    const album = await PhotoAlbum.create({
      _id: albumId,
      userId: ctx.userId,
      encryptedName,
      slug: String(albumId),
      description:
        typeof body.description === "string"
          ? body.description.trim().slice(0, 500)
          : undefined,
      objectIds,
      coverObjectId: objectIds[0],
    });

    const [serialized] = await serializeAlbums(ctx, [album.toObject()]);
    return NextResponse.json({ album: serialized }, { status: 201 });
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
