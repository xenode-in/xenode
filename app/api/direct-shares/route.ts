import { NextRequest, NextResponse } from "next/server";
import {
  assertObjectAccess,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import DirectShare from "@/models/DirectShare";
import { normalizeShareRole } from "@/lib/orgs/shareRoles";
import { captureEvent, countBucket } from "@/lib/posthog";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    const userId = ctx.userId;
    const {
      objectId,
      shareEncryptedDEK,
      shareKeyIv,
      shareEncryptedName,
      shareEncryptedContentType,
      shareEncryptedThumbnail,
      recipients,
    } = await request.json();

    if (!objectId) {
      return NextResponse.json({ error: "objectId is required" }, { status: 400 });
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json({ error: "At least one recipient is required" }, { status: 400 });
    }

    await dbConnect();

    const object = await assertObjectAccess(ctx, objectId, "share", { lean: true });

    if (object.isEncrypted && (!shareEncryptedDEK || !shareKeyIv)) {
      return NextResponse.json(
        { error: "Encrypted direct-share key package is required for E2EE files" },
        { status: 400 },
      );
    }

    const normalizedRecipients = Array.from(
      new Map(
        recipients.map((recipient: Record<string, unknown>) => [
          String(recipient.recipientUserId),
          {
            recipientUserId: String(recipient.recipientUserId),
            recipientEmail: String(recipient.recipientEmail).toLowerCase(),
            wrappedShareKey: String(recipient.wrappedShareKey),
            accessType: normalizeShareRole(recipient.accessType),
          },
        ]),
      ).values(),
    );

    if (normalizedRecipients.some((recipient) => !recipient.wrappedShareKey || !recipient.recipientEmail)) {
      return NextResponse.json({ error: "Each recipient must include an email and wrapped share key" }, { status: 400 });
    }

    const directShare = await DirectShare.create({
      objectId: object._id,
      bucketId: object.bucketId,
      createdBy: userId,
      shareEncryptedDEK,
      shareKeyIv,
      shareEncryptedName,
      shareEncryptedContentType,
      shareEncryptedThumbnail,
      recipients: normalizedRecipients,
    });

    captureEvent(userId, "direct_share_created", {
      shareType: "direct",
      recipientCountBucket: countBucket(normalizedRecipients.length),
      isEncrypted: !!object.isEncrypted,
    });

    return NextResponse.json({
      directShareId: directShare._id.toString(),
      recipientCount: normalizedRecipients.length,
    });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      if (error.code === "object_not_found") {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      return toJsonResponse(error);
    }

    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    await dbConnect();

    const directShares = await DirectShare.find({
      createdBy: ctx.userId,
      isRevoked: false,
    })
      .populate(
        "objectId",
        "key size contentType isEncrypted encryptedName encryptedContentType mediaCategory",
      )
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ directShares });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
