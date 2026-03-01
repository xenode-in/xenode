import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import ShareLink from "@/models/ShareLink";
import StorageObject from "@/models/StorageObject";
import bcrypt from "bcryptjs";
import { captureEvent } from "@/lib/posthog";

export const dynamic = "force-dynamic";

/** POST /api/share — Create a share link */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

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
      return NextResponse.json(
        { error: "objectId is required" },
        { status: 400 },
      );

    await dbConnect();

    const object = await StorageObject.findOne({ _id: objectId, userId });
    if (!object)
      return NextResponse.json({ error: "File not found" }, { status: 404 });

    if (object.isEncrypted && !shareEncryptedDEK)
      return NextResponse.json(
        { error: "shareEncryptedDEK required for encrypted files" },
        { status: 400 },
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
      shareData.expiresAt = new Date(
        Date.now() + Number(expiresIn) * 3_600_000,
      );
    if (maxDownloads) shareData.maxDownloads = Number(maxDownloads);
    if (shareEncryptedDEK) {
      shareData.shareEncryptedDEK = shareEncryptedDEK;
      shareData.shareKeyIv = shareKeyIv;
    }

    const link = await ShareLink.create(shareData);

    // Fire analytics event (non-blocking)
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
    if (error instanceof Error && error.message === "Unauthorized")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}

/** GET /api/share — List share links created by current user */
export async function GET() {
  try {
    const session = await requireAuth();
    await dbConnect();

    const links = await ShareLink.find({
      createdBy: session.user.id,
      isRevoked: false,
    })
      .populate("objectId", "key size contentType isEncrypted encryptedName")
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ shareLinks: links });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
