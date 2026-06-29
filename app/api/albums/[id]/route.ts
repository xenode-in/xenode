import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import PhotoAlbum from "@/models/PhotoAlbum";
import AlbumShareLink from "@/models/AlbumShareLink";
import { albumIdentifierFilter } from "@/lib/albums/slug";
import { deleteAlbumShareThumbnails } from "@/lib/albums/cleanup";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function normalizeName(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const name = normalizeName(body.name);
    if (!name) {
      return NextResponse.json({ error: "Album name is required" }, { status: 400 });
    }

    await dbConnect();

    // Slug stays stable across renames so existing album URLs keep resolving.
    const album = await PhotoAlbum.findOneAndUpdate(
      albumIdentifierFilter(session.user.id, id),
      {
        name,
        description:
          typeof body.description === "string"
            ? body.description.trim().slice(0, 500)
            : undefined,
      },
      { new: true },
    ).lean();

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    return NextResponse.json({
      album: {
        ...album,
        _id: String(album._id),
        slug: album.slug ?? String(album._id),
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
