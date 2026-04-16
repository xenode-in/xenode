import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import DirectShare from "@/models/DirectShare";
import type { IDirectShareRecipient } from "@/models/DirectShare";
import { User } from "@/models/User";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth(request);
    const { id } = await params;
    await dbConnect();

    const share = await DirectShare.findOne({ _id: id, isRevoked: false })
      .populate("objectId", "key size contentType isEncrypted encryptedName thumbnail mediaCategory")
      .lean();

    if (!share) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    const recipients = (share.recipients || []) as IDirectShareRecipient[];
    const recipient = recipients.find(
      (item) => item.recipientUserId === session.user.id,
    );

    if (!recipient) {
      return NextResponse.json({ error: "You do not have access to this share" }, { status: 403 });
    }

    const owner = await User.findById(share.createdBy).select("_id name email").lean();

    return NextResponse.json({
      _id: String(share._id),
      objectId: share.objectId,
      owner: owner
        ? { id: String(owner._id), name: owner.name, email: owner.email }
        : null,
      shareEncryptedDEK: share.shareEncryptedDEK,
      shareKeyIv: share.shareKeyIv,
      shareEncryptedName: share.shareEncryptedName,
      shareEncryptedContentType: share.shareEncryptedContentType,
      shareEncryptedThumbnail: share.shareEncryptedThumbnail,
      recipient,
      createdAt: share.createdAt,
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

    const share = await DirectShare.findOneAndUpdate(
      { _id: id, createdBy: session.user.id },
      { isRevoked: true },
      { new: true },
    );

    if (!share) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth(request);
    const { id } = await params;
    const body = await request.json();
    await dbConnect();

    const update: Record<string, unknown> = {};

    if ("recipients" in body) {
      if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
        return NextResponse.json(
          {
            error:
              "Direct shares must have at least one recipient. Revoke the share instead.",
          },
          { status: 400 },
        );
      }

      update.recipients = body.recipients.map(
        (recipient: Record<string, unknown>) => ({
          recipientUserId: String(recipient.recipientUserId),
          recipientEmail: String(recipient.recipientEmail).toLowerCase(),
          wrappedShareKey: String(recipient.wrappedShareKey),
          accessType: recipient.accessType === "view" ? "view" : "download",
          downloadCount: Number(recipient.downloadCount || 0),
          lastAccessedAt: recipient.lastAccessedAt
            ? new Date(String(recipient.lastAccessedAt))
            : undefined,
        }),
      );
    }

    if (body.shareEncryptedDEK) {
      update.shareEncryptedDEK = body.shareEncryptedDEK;
      update.shareKeyIv = body.shareKeyIv;
      update.shareEncryptedName = body.shareEncryptedName;
      update.shareEncryptedContentType = body.shareEncryptedContentType;
    }

    const share = await DirectShare.findOneAndUpdate(
      { _id: id, createdBy: session.user.id, isRevoked: false },
      { $set: update },
      { new: true },
    )
      .populate(
        "objectId",
        "key size contentType isEncrypted encryptedName encryptedContentType mediaCategory",
      )
      .lean();

    if (!share) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    return NextResponse.json({ directShare: share });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
