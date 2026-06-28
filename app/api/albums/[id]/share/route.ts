import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import bcrypt from "bcryptjs";

import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import PhotoAlbum from "@/models/PhotoAlbum";
import StorageObject from "@/models/StorageObject";
import AlbumShareLink from "@/models/AlbumShareLink";
import { albumIdentifierFilter } from "@/lib/albums/slug";
import { deleteAlbumShareThumbnails } from "@/lib/albums/cleanup";
import { captureEvent } from "@/lib/posthog";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface IncomingItem {
  objectId?: string;
  shareEncryptedDEK?: string;
  shareKeyIv?: string;
  shareEncryptedName?: string;
  shareEncryptedContentType?: string;
  shareEncryptedThumbnail?: string;
}

function shareUrl(token: string) {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/album/${token}`;
}

/** GET — return the current active share link for this album (owner only). */
export async function GET(request: NextRequest, { params }: RouteParams) {
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

    const link = await AlbumShareLink.findOne({
      albumId: album._id,
      createdBy: session.user.id,
      isRevoked: false,
    }).lean();

    if (!link) return NextResponse.json({ share: null });

    return NextResponse.json({
      share: {
        token: link.token,
        shareUrl: shareUrl(link.token),
        itemCount: link.items.length,
        isPasswordProtected: link.isPasswordProtected,
        expiresAt: link.expiresAt ?? null,
        maxViews: link.maxViews ?? null,
        viewCount: link.viewCount,
        createdAt: link.createdAt,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST — create a public share for the album. The client has already wrapped
 * each photo's DEK with a freshly generated share key (which it keeps in the
 * URL fragment) and re-encrypted names/content-types/thumbnails. We only verify
 * ownership and persist the opaque ciphertext bundle.
 *
 * Recreating a share revokes any prior active link for the album so a given
 * album has at most one live public link.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth(request);
    const userId = session.user.id;
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    await dbConnect();

    const album = await PhotoAlbum.findOne(
      albumIdentifierFilter(userId, id),
    ).lean();
    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    const incoming: IncomingItem[] = Array.isArray(body.items) ? body.items : [];
    const requestedIds = incoming
      .map((item) => item.objectId)
      .filter((v): v is string => typeof v === "string" && Types.ObjectId.isValid(v));

    if (requestedIds.length === 0) {
      return NextResponse.json(
        { error: "Album has no shareable photos" },
        { status: 400 },
      );
    }

    // Only let through objects the user actually owns AND that belong to the
    // album — never trust the client's object list blindly.
    const albumObjectIds = new Set((album.objectIds ?? []).map(String));
    const ownedObjects = await StorageObject.find({
      _id: { $in: requestedIds.map((v) => new Types.ObjectId(v)) },
      userId,
      deletedAt: { $exists: false },
    })
      .select("_id isEncrypted")
      .lean<Array<{ _id: Types.ObjectId; isEncrypted?: boolean }>>();
    const ownedById = new Map(ownedObjects.map((o) => [String(o._id), o]));

    const items = incoming
      .filter((item) => {
        const oid = item.objectId ?? "";
        if (!albumObjectIds.has(oid) || !ownedById.has(oid)) return false;
        // Encrypted objects must carry a wrapped DEK; plaintext ones may skip.
        const obj = ownedById.get(oid);
        if (obj?.isEncrypted && (!item.shareEncryptedDEK || !item.shareKeyIv)) {
          return false;
        }
        return true;
      })
      .map((item) => ({
        objectId: new Types.ObjectId(item.objectId),
        shareEncryptedDEK: item.shareEncryptedDEK ?? "",
        shareKeyIv: item.shareKeyIv ?? "",
        shareEncryptedName: item.shareEncryptedName,
        shareEncryptedContentType: item.shareEncryptedContentType,
        shareEncryptedThumbnail: item.shareEncryptedThumbnail,
      }));

    if (items.length === 0) {
      return NextResponse.json(
        { error: "No valid photos to share" },
        { status: 400 },
      );
    }

    // Replace any existing active link so the album has a single live share.
    // Delete the prior link's thumbnail blobs first so they don't orphan in B2.
    const priorLinks = await AlbumShareLink.find({
      albumId: album._id,
      createdBy: userId,
      isRevoked: false,
    })
      .select("items")
      .lean();
    for (const prior of priorLinks) {
      await deleteAlbumShareThumbnails(userId, prior.items);
    }
    await AlbumShareLink.updateMany(
      { albumId: album._id, createdBy: userId, isRevoked: false },
      { $set: { isRevoked: true } },
    );

    const data: Record<string, unknown> = {
      albumId: album._id,
      createdBy: userId,
      shareEncryptedAlbumName:
        typeof body.shareEncryptedAlbumName === "string"
          ? body.shareEncryptedAlbumName
          : undefined,
      items,
      isPasswordProtected: !!body.password,
    };
    if (body.password) {
      data.passwordHash = await bcrypt.hash(String(body.password), 12);
    }
    if (body.expiresIn) {
      data.expiresAt = new Date(Date.now() + Number(body.expiresIn) * 3_600_000);
    }
    if (body.maxViews) data.maxViews = Math.max(1, Number(body.maxViews));

    const link = await AlbumShareLink.create(data);

    captureEvent(userId, "album_share_link_created", {
      itemCount: items.length,
      isPasswordProtected: !!body.password,
      hasExpiry: !!body.expiresIn,
      hasMaxViews: !!body.maxViews,
    });

    return NextResponse.json(
      {
        token: link.token,
        shareUrl: shareUrl(link.token),
        itemCount: items.length,
        isPasswordProtected: link.isPasswordProtected,
        expiresAt: link.expiresAt ?? null,
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** DELETE — revoke the album's active public link (owner only). */
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

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
