import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  ownerClause,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import ShareLink from "@/models/ShareLink";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ token: string }>;
}

interface SharedBundleItem {
  objectId?: SharedObjectMeta | null;
  shareEncryptedDEK?: string;
  shareKeyIv?: string;
  shareEncryptedName?: string;
  shareEncryptedContentType?: string;
  shareEncryptedThumbnail?: string;
}

interface SharedObjectMeta {
  _id?: unknown;
  key?: string;
  size?: number;
  contentType?: string;
  isEncrypted?: boolean;
  encryptedName?: string;
  thumbnail?: string;
  mediaCategory?: string;
}

/** GET /api/share/[token] — Public metadata (no auth required) */
export async function GET(_: NextRequest, { params }: Params) {
  const resolvedParams = await params;
  await dbConnect();

  const link = await ShareLink.findOne({ token: resolvedParams.token, isRevoked: false })
    .populate("objectId", "key size contentType isEncrypted encryptedName thumbnail mediaCategory")
    .populate("bundleItems.objectId", "key size contentType isEncrypted encryptedName thumbnail mediaCategory")
    .lean();

  if (!link) return NextResponse.json({ error: "Link not found or revoked" }, { status: 404 });
  if (link.expiresAt && new Date() > link.expiresAt) return NextResponse.json({ error: "This link has expired" }, { status: 410 });
  if (link.maxDownloads && link.downloadCount >= link.maxDownloads) return NextResponse.json({ error: "Download limit reached" }, { status: 410 });

  const obj = link.objectId as SharedObjectMeta | null;
  const bundleItems = (link.bundleItems || []) as SharedBundleItem[];
  const isBundle = !!link.isBundle && bundleItems.length > 0;

  const response = {
    id: obj?._id,
    isBundle,
    bundleName: isBundle
      ? link.isPasswordProtected
        ? "Locked Folder"
        : link.bundleName || `${bundleItems.length} shared files`
      : undefined,
    items: isBundle
      ? bundleItems
          .map((item) => {
            const itemObj = item.objectId;
            if (!itemObj) return null;
            return {
              id: itemObj._id,
              name: link.isPasswordProtected
                ? "Locked File"
                : item.shareEncryptedName ||
                  itemObj.encryptedName ||
                  itemObj.key?.split("/").pop(),
              encryptedName: link.isPasswordProtected
                ? undefined
                : item.shareEncryptedName || itemObj.encryptedName,
              shareEncryptedName: link.isPasswordProtected
                ? undefined
                : item.shareEncryptedName,
              shareEncryptedContentType: link.isPasswordProtected
                ? undefined
                : item.shareEncryptedContentType,
              shareEncryptedThumbnail: link.isPasswordProtected
                ? undefined
                : item.shareEncryptedThumbnail,
              size: itemObj.size,
              contentType: link.isPasswordProtected
                ? "application/octet-stream"
                : item.shareEncryptedContentType || itemObj.contentType,
              mediaCategory: itemObj.mediaCategory,
              isEncrypted: itemObj.isEncrypted,
              shareEncryptedDEK: link.isPasswordProtected
                ? undefined
                : item.shareEncryptedDEK,
              shareKeyIv: link.isPasswordProtected ? undefined : item.shareKeyIv,
              thumbnail: link.isPasswordProtected
                ? undefined
                : item.shareEncryptedThumbnail || itemObj.thumbnail,
            };
          })
          .filter(Boolean)
      : undefined,
    name: link.isPasswordProtected ? "Locked File" : (link.shareEncryptedName || obj?.encryptedName || obj?.key?.split("/").pop()),
    encryptedName: link.isPasswordProtected ? undefined : (link.shareEncryptedName || obj?.encryptedName),
    shareEncryptedName: link.isPasswordProtected ? undefined : link.shareEncryptedName,
    shareEncryptedContentType: link.isPasswordProtected ? undefined : link.shareEncryptedContentType,
    shareEncryptedThumbnail: link.isPasswordProtected ? undefined : link.shareEncryptedThumbnail,
    size: obj?.size,
    contentType: link.isPasswordProtected ? "application/octet-stream" : (link.shareEncryptedContentType || obj?.contentType),
    mediaCategory: obj?.mediaCategory,
    isEncrypted: obj?.isEncrypted,
    isPasswordProtected: link.isPasswordProtected,
    expiresAt: link.expiresAt,
    // DEK is ONLY for the recipient who knows the password (sent via POST)
    // or if there is no password, we can send it now.
    shareEncryptedDEK: link.isPasswordProtected ? undefined : link.shareEncryptedDEK,
    shareKeyIv: link.isPasswordProtected ? undefined : link.shareKeyIv,
    thumbnail: link.isPasswordProtected ? undefined : (link.shareEncryptedThumbnail || obj?.thumbnail),
  };

  return NextResponse.json(response);
}

/** DELETE /api/share/[token] — Revoke a share link (owner only) */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const resolvedParams = await params;
    const ctx = await requireAccessContext(request);
    ownerClause(ctx);
    await dbConnect();

    const link = await ShareLink.findOneAndUpdate(
      { token: resolvedParams.token, createdBy: ctx.userId },
      { isRevoked: true },
      { new: true },
    );

    if (!link) return NextResponse.json({ error: "Not found or not authorised" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    if (error instanceof Error && error.message === "Unauthorized")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const resolvedParams = await params;
    const ctx = await requireAccessContext(request);
    ownerClause(ctx);
    const body = await request.json();
    await dbConnect();

    const update: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};
    const existingLink = await ShareLink.findOne({
      token: resolvedParams.token,
      createdBy: ctx.userId,
      isRevoked: false,
    });

    if (!existingLink) {
      return NextResponse.json(
        { error: "Not found or not authorised" },
        { status: 404 },
      );
    }

    if ("expiresAt" in body) {
      if (body.expiresAt) update.expiresAt = new Date(body.expiresAt);
      else unset.expiresAt = "";
    }

    if ("maxDownloads" in body) {
      if (body.maxDownloads === null || body.maxDownloads === "") {
        unset.maxDownloads = "";
      } else {
        update.maxDownloads = Math.max(1, Number(body.maxDownloads));
      }
    }

    if ("sharedWith" in body) {
      update.sharedWith = Array.isArray(body.sharedWith)
        ? body.sharedWith
            .map((email: unknown) => String(email).trim().toLowerCase())
            .filter(Boolean)
        : [];
    }

    if ("bundleName" in body && existingLink.isBundle) {
      const nextName = String(body.bundleName || "").trim();
      if (nextName) update.bundleName = nextName.slice(0, 120);
    }

    if ("bundleItemIds" in body && existingLink.isBundle) {
      if (!Array.isArray(body.bundleItemIds)) {
        return NextResponse.json(
          { error: "bundleItemIds must be an array" },
          { status: 400 },
        );
      }
      const allowedIds = new Set(
        body.bundleItemIds.map((id: unknown) => String(id)),
      );
      const nextItems = (existingLink.bundleItems || []).filter((item) =>
        allowedIds.has(item.objectId.toString()),
      );
      if (nextItems.length === 0) {
        return NextResponse.json(
          { error: "A bundle share must include at least one file" },
          { status: 400 },
        );
      }
      update.bundleItems = nextItems;
      update.objectId = nextItems[0].objectId;
    }

    if (body.accessType === "view" || body.accessType === "download") {
      update.accessType = body.accessType;
    }

    if (body.shareEncryptedDEK) {
      update.shareEncryptedDEK = body.shareEncryptedDEK;
      update.shareKeyIv = body.shareKeyIv;
      update.shareEncryptedName = body.shareEncryptedName;
      update.shareEncryptedContentType = body.shareEncryptedContentType;
      if (body.ownerEncryptedShareKey) {
        update.ownerEncryptedShareKey = body.ownerEncryptedShareKey;
      }
    }

    const link = await ShareLink.findOneAndUpdate(
      { _id: existingLink._id },
      {
        ...(Object.keys(update).length > 0 ? { $set: update } : {}),
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
      { new: true },
    ).lean();

    if (!link) {
      return NextResponse.json(
        { error: "Not found or not authorised" },
        { status: 404 },
      );
    }

    return NextResponse.json({ shareLink: link });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    if (error instanceof Error && error.message === "Unauthorized")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
