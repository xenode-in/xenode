import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import PhotoAlbum from "@/models/PhotoAlbum";
import AlbumShareLink from "@/models/AlbumShareLink";
import { albumIdentifierFilter } from "@/lib/albums/slug";
import { deleteAlbumShareThumbnails } from "@/lib/albums/cleanup";
import { ENCRYPTED_ALBUM_NAME_PLACEHOLDER } from "@/lib/albums/constants";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function normalizeName(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function normalizeEncryptedName(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 2048) : "";
}

function normalizeSourceRef(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 128) : "";
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const name = normalizeName(body.name);
    const encryptedName = normalizeEncryptedName(body.encryptedName);
    const sourceRef = normalizeSourceRef(body.sourceRef);
    if (!name && !encryptedName && !sourceRef) {
      return NextResponse.json(
        { error: "Album name is required" },
        { status: 400 },
      );
    }

    await dbConnect();

    const update: Record<string, unknown> = {};
    if (encryptedName) {
      update.encryptedName = encryptedName;
      // E2EE rename: keep the required plaintext field on a placeholder
      // unless the client also sent an explicit plaintext name.
      update.name = name || ENCRYPTED_ALBUM_NAME_PLACEHOLDER;
    } else if (name) {
      update.name = name;
    }
    if (sourceRef) update.sourceRef = sourceRef;
    if (typeof body.description === "string") {
      update.description = body.description.trim().slice(0, 500);
    }

    // Slug stays stable across renames so existing album URLs keep resolving.
    let album;
    try {
      album = await PhotoAlbum.findOneAndUpdate(
        albumIdentifierFilter(session.user.id, id),
        update,
        { new: true },
      ).lean();
    } catch (error) {
      if (isDuplicateKeyError(error) && sourceRef) {
        // Another album already owns this sourceRef — tell the client which
        // one so it can converge instead of retrying forever.
        const conflict = await PhotoAlbum.findOne({
          userId: session.user.id,
          sourceRef,
        })
          .select("_id")
          .lean();
        return NextResponse.json(
          {
            error: "sourceRef already in use",
            conflictAlbumId: conflict ? String(conflict._id) : null,
          },
          { status: 409 },
        );
      }
      throw error;
    }

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    return NextResponse.json({
      album: {
        ...album,
        _id: String(album._id),
        slug: album.slug ?? String(album._id),
        encryptedName: album.encryptedName ?? null,
        sourceRef: album.sourceRef ?? null,
        objectIds: (album.objectIds ?? []).map(String),
        objectCount: album.objectIds?.length ?? 0,
      },
    });
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
    await dbConnect();

    const album = await PhotoAlbum.findOne(
      albumIdentifierFilter(session.user.id, id),
    ).lean();

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    const links = await AlbumShareLink.find({
      albumId: album._id,
      createdBy: session.user.id,
      isRevoked: false,
    })
      .select("items")
      .lean();
    for (const link of links) {
      await deleteAlbumShareThumbnails(session.user.id, link.items);
    }
    await AlbumShareLink.updateMany(
      { albumId: album._id, createdBy: session.user.id, isRevoked: false },
      { $set: { isRevoked: true } },
    );

    await PhotoAlbum.deleteOne({ _id: album._id, userId: session.user.id });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
