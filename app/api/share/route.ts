import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { logRequest } from "@/lib/logRequest";
import dbConnect from "@/lib/mongodb";
import ShareLink from "@/models/ShareLink";
import StorageObject from "@/models/StorageObject";
import bcrypt from "bcryptjs";
import { captureEvent } from "@/lib/posthog";

export const dynamic = "force-dynamic";

/** POST /api/share — Create a share link */
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const session = await requireAuth(req);
    userId = session.user.id;

    const {
      objectId, expiresIn, maxDownloads, password,
      accessType = "download", shareEncryptedDEK, shareKeyIv, sharedWith = [],
    } = await req.json();

    if (!objectId) {
      statusCode = 400;
      errorMessage = "objectId is required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    await dbConnect();

    const object = await StorageObject.findOne({ _id: objectId, userId });
    if (!object) {
      statusCode = 404;
      errorMessage = "File not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    if (object.isEncrypted && !shareEncryptedDEK) {
      statusCode = 400;
      errorMessage = "shareEncryptedDEK required for encrypted files";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const shareData: Record<string, unknown> = {
      objectId: object._id,
      bucketId: object.bucketId,
      createdBy: userId,
      accessType,
      isPasswordProtected: !!password,
      sharedWith: Array.isArray(sharedWith) ? sharedWith : [],
    };

    if (password) shareData.passwordHash = await bcrypt.hash(password, 12);
    if (expiresIn) shareData.expiresAt = new Date(Date.now() + Number(expiresIn) * 3_600_000);
    if (maxDownloads) shareData.maxDownloads = Number(maxDownloads);
    if (shareEncryptedDEK) { shareData.shareEncryptedDEK = shareEncryptedDEK; shareData.shareKeyIv = shareKeyIv; }

    const link = await ShareLink.create(shareData);

    captureEvent(userId, "share_link_created", {
      accessType,
      isPasswordProtected: !!password,
      expiresIn: expiresIn ? Number(expiresIn) : null,
      hasMaxDownloads: !!maxDownloads,
    });

    return NextResponse.json({
      token: link.token,
      shareUrl: `${process.env.NEXT_PUBLIC_APP_URL}/shared/${link.token}`,
      expiresAt: link.expiresAt,
      isPasswordProtected: link.isPasswordProtected,
    });
  } catch (error: unknown) {
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
    const session = await requireAuth(req);
    userId = session.user.id;
    await dbConnect();

    const links = await ShareLink.find({ createdBy: userId, isRevoked: false })
      .populate("objectId", "key size contentType isEncrypted encryptedName")
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ shareLinks: links });
  } catch (error: unknown) {
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
