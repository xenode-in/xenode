import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import ShareLink from "@/models/ShareLink";
import StorageObject from "@/models/StorageObject";
import bcrypt from "bcryptjs";
import { captureEvent } from "@/lib/posthog";
import { logRequest } from "@/lib/logRequest";

export const dynamic = "force-dynamic";

/** POST /api/share — Create a share link */
export async function POST(req: NextRequest) {
  const start = Date.now();
  let userId = "";
  try {
    const session = await requireAuth();
    userId = session.user.id;

    const {
      objectId,
      expiresIn,
      maxDownloads,
      password,
      accessType = "download",
      shareEncryptedDEK,
      shareKeyIv,
      sharedWith = [],
    } = await req.json();

    if (!objectId)
      return NextResponse.json({ error: "objectId is required" }, { status: 400 });

    await dbConnect();

    const object = await StorageObject.findOne({ _id: objectId, userId });
    if (!object)
      return NextResponse.json({ error: "File not found" }, { status: 404 });

    if (object.isEncrypted && !shareEncryptedDEK)
      return NextResponse.json(
        { error: "shareEncryptedDEK required for encrypted files" },
        { status: 400 }
      );

    const shareData: Record<string, unknown> = {
      objectId: object._id,
      bucketId: object.bucketId,
      createdBy: userId,
      accessType,
      isPasswordProtected: !!password,
      sharedWith: Array.isArray(sharedWith) ? sharedWith : [],
    };

    if (password) shareData.passwordHash = await bcrypt.hash(password, 12);
    if (expiresIn)
      shareData.expiresAt = new Date(Date.now() + Number(expiresIn) * 3_600_000);
    if (maxDownloads) shareData.maxDownloads = Number(maxDownloads);
    if (shareEncryptedDEK) {
      shareData.shareEncryptedDEK = shareEncryptedDEK;
      shareData.shareKeyIv = shareKeyIv;
    }

    const link = await ShareLink.create(shareData);

    captureEvent(userId, "share_link_created", {
      accessType,
      isPasswordProtected: !!password,
      hasExpiry: !!expiresIn,
      hasMaxDownloads: !!maxDownloads,
    });

    logRequest({
      userId,
      method: "POST",
      endpoint: "/api/share",
      statusCode: 200,
      durationMs: Date.now() - start,
      ip: req.headers.get("x-forwarded-for") ?? "unknown",
      userAgent: req.headers.get("user-agent") ?? "unknown",
      metadata: { accessType, isPasswordProtected: !!password },
    });

    return NextResponse.json({
      token: link.token,
      shareUrl: `${process.env.NEXT_PUBLIC_APP_URL}/shared/${link.token}`,
      expiresAt: link.expiresAt,
      isPasswordProtected: link.isPasswordProtected,
    });
  } catch (error: unknown) {
    const isUnauth = error instanceof Error && error.message === "Unauthorized";
    const statusCode = isUnauth ? 401 : 500;
    const message = isUnauth
      ? "Unauthorized"
      : error instanceof Error
      ? error.message
      : "Internal server error";

    logRequest({
      userId: userId || null,
      method: "POST",
      endpoint: "/api/share",
      statusCode,
      durationMs: Date.now() - start,
      ip: req.headers.get("x-forwarded-for") ?? "unknown",
      userAgent: req.headers.get("user-agent") ?? "unknown",
      errorMessage: message,
    });

    return NextResponse.json({ error: message }, { status: statusCode });
  }
}

/** GET /api/share — List share links created by current user */
export async function GET(req: NextRequest) {
  const start = Date.now();
  let userId = "";
  try {
    const session = await requireAuth();
    userId = session.user.id;

    await dbConnect();
    const links = await ShareLink.find({ createdBy: userId, isRevoked: false })
      .populate("objectId", "key size contentType isEncrypted encryptedName")
      .sort({ createdAt: -1 })
      .lean();

    logRequest({
      userId,
      method: "GET",
      endpoint: "/api/share",
      statusCode: 200,
      durationMs: Date.now() - start,
      ip: req.headers.get("x-forwarded-for") ?? "unknown",
      userAgent: req.headers.get("user-agent") ?? "unknown",
      metadata: { count: links.length },
    });

    return NextResponse.json({ shareLinks: links });
  } catch (error: unknown) {
    const isUnauth = error instanceof Error && error.message === "Unauthorized";
    const statusCode = isUnauth ? 401 : 500;
    const message = isUnauth ? "Unauthorized" : "Internal server error";

    logRequest({
      userId: userId || null,
      method: "GET",
      endpoint: "/api/share",
      statusCode,
      durationMs: Date.now() - start,
      ip: req.headers.get("x-forwarded-for") ?? "unknown",
      userAgent: req.headers.get("user-agent") ?? "unknown",
      errorMessage: message,
    });

    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
