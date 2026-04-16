import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import DirectShare from "@/models/DirectShare";
import StorageObject from "@/models/StorageObject";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const userId = session.user.id;
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

    const object = await StorageObject.findOne({ _id: objectId, userId }).lean();
    if (!object) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

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
            accessType:
              recipient.accessType === "view" ? "view" : "download",
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

    return NextResponse.json({
      directShareId: directShare._id.toString(),
      recipientCount: normalizedRecipients.length,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnect();

    const directShares = await DirectShare.find({
      createdBy: session.user.id,
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
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
