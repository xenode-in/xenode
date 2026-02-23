import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import ShareLink from "@/models/ShareLink";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ token: string }>;
}

/** GET /api/share/[token] — Public metadata (no auth required) */
export async function GET(_: NextRequest, { params }: Params) {
  const resolvedParams = await params;
  await dbConnect();

  const link = await ShareLink.findOne({
    token: resolvedParams.token,
    isRevoked: false,
  })
    .populate(
      "objectId",
      "key size contentType isEncrypted encryptedName thumbnail",
    )
    .lean();

  if (!link)
    return NextResponse.json(
      { error: "Link not found or revoked" },
      { status: 404 },
    );

  if (link.expiresAt && new Date() > link.expiresAt)
    return NextResponse.json(
      { error: "This link has expired" },
      { status: 410 },
    );

  if (link.maxDownloads && link.downloadCount >= link.maxDownloads)
    return NextResponse.json(
      { error: "Download limit reached" },
      { status: 410 },
    );

  const obj = link.objectId as any;

  return NextResponse.json({
    fileName: obj?.key ?? "",
    encryptedName: obj?.encryptedName,
    size: obj?.size ?? 0,
    contentType: obj?.contentType ?? "application/octet-stream",
    isEncrypted: obj?.isEncrypted ?? false,
    thumbnail: obj?.thumbnail,
    isPasswordProtected: link.isPasswordProtected,
    accessType: link.accessType,
    expiresAt: link.expiresAt,
    downloadCount: link.downloadCount,
    maxDownloads: link.maxDownloads,
    shareEncryptedDEK: link.shareEncryptedDEK,
    shareKeyIv: link.shareKeyIv,
  });
}

/** DELETE /api/share/[token] — Revoke a share link (owner only) */
export async function DELETE(_: NextRequest, { params }: Params) {
  try {
    const resolvedParams = await params;
    const session = await requireAuth();
    await dbConnect();

    const link = await ShareLink.findOneAndUpdate(
      { token: resolvedParams.token, createdBy: session.user.id },
      { isRevoked: true },
      { new: true },
    );

    if (!link)
      return NextResponse.json(
        { error: "Not found or not authorised" },
        { status: 404 },
      );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
