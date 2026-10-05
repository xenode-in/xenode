import { getServerProductOrigin } from "@xenode/config";
import { NextRequest, NextResponse } from "next/server";
import {
  AuthzError,
  assertObjectAccess,
  isAuthzError,
  ownerClause,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { logRequest } from "@/lib/logRequest";
import dbConnect from "@/lib/mongodb";
import ShareLink from "@/models/ShareLink";
import { enforceOrganizationSharePolicy } from "@/lib/orgs/sharePolicy";
import bcrypt from "bcryptjs";
import { captureEvent } from "@/lib/posthog";
import { Space } from "@xenode/database/models";
import { getDatabase, withTransaction } from "@xenode/database/connection";

export const dynamic = "force-dynamic";

interface ShareBundleInputItem {
  objectId?: string;
  shareEncryptedDEK?: string;
  shareKeyIv?: string;
  shareEncryptedName?: string;
  shareEncryptedContentType?: string;
  shareEncryptedThumbnail?: string;
}

/** POST /api/share — Create a share link */
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const ctx = await requireAccessContext(req);
    userId = ctx.userId;

    const {
      token, objectId, items, bundleName, expiresIn, maxDownloads, password,
      accessType = "download", shareEncryptedDEK, shareKeyIv,
      shareEncryptedName, shareEncryptedContentType, shareEncryptedThumbnail,
      ownerEncryptedShareKey,
      sharedWith = [],
    } = await req.json();

    const bundleItemsInput = Array.isArray(items)
      ? (items as ShareBundleInputItem[])
      : [];
    const isBundle = bundleItemsInput.length > 1;

    if (!objectId && bundleItemsInput.length === 0) {
      statusCode = 400;
      errorMessage = "objectId or items are required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    await dbConnect();

    const objectIds = isBundle
      ? bundleItemsInput.map((item) => item.objectId).filter(Boolean)
      : [objectId || bundleItemsInput[0]?.objectId].filter(Boolean);

    if (objectIds.length === 0) {
      statusCode = 400;
      errorMessage = "No files selected";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const objects = await Promise.all(
      objectIds.map((id) => assertObjectAccess(ctx, id!, "share")),
    );
    const object = objects[0];
    if (ctx.spaceType === "organization" || ctx.spaceType === "team") {
      const policyResponse = await enforceOrganizationSharePolicy({
        orgId: ctx.organizationId!,
        hasPassword: !!password,
        hasExpiry: !!expiresIn,
      });
      if (policyResponse) {
        statusCode = policyResponse.status;
        return policyResponse;
      }
    }

    if (!isBundle && object.isEncrypted && !shareEncryptedDEK) {
      statusCode = 400;
      errorMessage = "shareEncryptedDEK required for encrypted files";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const objectById = new Map(
      objects.map((candidate) => [candidate._id.toString(), candidate]),
    );
    const bundleItems = isBundle
      ? bundleItemsInput.map((item) => {
          const target = item.objectId ? objectById.get(item.objectId) : null;
          if (!target) throw new Error("Invalid bundle item");
          if (target.isEncrypted && !item.shareEncryptedDEK) {
            throw new Error("shareEncryptedDEK required for encrypted files");
          }
          return {
            objectId: target._id,
            shareEncryptedDEK: item.shareEncryptedDEK,
            shareKeyIv: item.shareKeyIv,
            shareEncryptedName: item.shareEncryptedName,
            shareEncryptedContentType: item.shareEncryptedContentType,
            shareEncryptedThumbnail: item.shareEncryptedThumbnail,
          };
        })
      : undefined;

    const shareData: Record<string, unknown> = {
      token,
      objectId: object._id,
      bucketId: object.bucketId,
      createdBy: userId,
      accessType,
      isPasswordProtected: !!password,
      sharedWith: Array.isArray(sharedWith) ? sharedWith : [],
      isBundle,
    };

    if (isBundle) {
      shareData.bundleName =
        typeof bundleName === "string" && bundleName.trim()
          ? bundleName.trim().slice(0, 120)
          : `${objects.length} shared files`;
      shareData.bundleItems = bundleItems;
    }
    if (password) shareData.passwordHash = await bcrypt.hash(password, 12);
    if (expiresIn) shareData.expiresAt = new Date(Date.now() + Number(expiresIn) * 3_600_000);
    if (maxDownloads) shareData.maxDownloads = Number(maxDownloads);
    if (shareEncryptedDEK) {
      shareData.shareEncryptedDEK = shareEncryptedDEK;
      shareData.shareKeyIv = shareKeyIv;
      shareData.shareEncryptedName = shareEncryptedName;
      if (ownerEncryptedShareKey) {
        shareData.ownerEncryptedShareKey = ownerEncryptedShareKey;
      }
      if (shareEncryptedContentType) {
        shareData.shareEncryptedContentType = shareEncryptedContentType;
      }
      if (shareEncryptedThumbnail) {
        shareData.shareEncryptedThumbnail = shareEncryptedThumbnail;
      }
    }

    const link = await withTransaction(async (session) => {
      const space = await Space.updateOne({ _id: ctx.spaceId, status: "active" }, {
        $inc: { storageFenceVersion: 1 },
      }, { session });
      const ids = [...new Set(objects.map((candidate) => String(candidate._id)))];
      const claimed = await getDatabase().collection("storageobjects").updateMany({
        _id: { $in: objects.map((candidate) => candidate._id) },
        spaceId: ctx.spaceId, deletedAt: null, purgeState: { $exists: false },
      }, { $inc: { __v: 1 } }, { session });
      if (space.matchedCount !== 1 || claimed.matchedCount !== ids.length) {
        throw new AuthzError(409, "share_source_changed", "File is unavailable");
      }
      const [created] = await ShareLink.create([shareData], { session });
      return created;
    });

    captureEvent(userId, "share_link_created", {
      accessType,
      isPasswordProtected: !!password,
      hasExpiry: !!expiresIn,
      hasMaxDownloads: !!maxDownloads,
      shareType: isBundle ? "bundle_link" : "link",
      itemCount: objects.length,
    });

    return NextResponse.json({
      token: link.token,
      shareUrl: `${getServerProductOrigin("drive")}/shared/${link.token}`,
      expiresAt: link.expiresAt,
      isPasswordProtected: link.isPasswordProtected,
    });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      statusCode = error.status;
      errorMessage =
        error.code === "object_not_found" ? "File not found" : error.message;
      return NextResponse.json(
        { error: errorMessage, code: error.code },
        { status: statusCode },
      );
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      statusCode = 401;
      errorMessage = "Unauthorized";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    statusCode = 500;
    errorMessage = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  } finally {
    logRequest({
      userId,
      method: req.method,
      endpoint: req.nextUrl.pathname,
      statusCode,
      durationMs: Date.now() - startTime,
      ip: req.headers.get("x-forwarded-for") || "unknown",
      userAgent: req.headers.get("user-agent") || "unknown",
      errorMessage,
    });
  }
}

/** GET /api/share — List share links created by current user */
export async function GET(req: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const ctx = await requireAccessContext(req);
    userId = ctx.userId;
    ownerClause(ctx);
    await dbConnect();

    const links = await ShareLink.find({ createdBy: userId, isRevoked: false })
      .populate(
        "objectId",
        "key size contentType isEncrypted encryptedName encryptedContentType mediaCategory",
      )
      .populate(
        "bundleItems.objectId",
        "key size contentType isEncrypted encryptedName encryptedContentType thumbnail mediaCategory",
      )
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ shareLinks: links });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      statusCode = error.status;
      errorMessage = error.message;
      return toJsonResponse(error);
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      statusCode = 401;
      errorMessage = "Unauthorized";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    statusCode = 500;
    errorMessage = "Internal server error";
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  } finally {
    logRequest({
      userId,
      method: req.method,
      endpoint: req.nextUrl.pathname,
      statusCode,
      durationMs: Date.now() - startTime,
      ip: req.headers.get("x-forwarded-for") || "unknown",
      userAgent: req.headers.get("user-agent") || "unknown",
      errorMessage,
    });
  }
}
