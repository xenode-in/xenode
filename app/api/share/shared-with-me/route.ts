import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import ShareLink from "@/models/ShareLink";

export const dynamic = "force-dynamic";

/** GET /api/share/shared-with-me — List share links shared with current user */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnect();

    const links = await ShareLink.find({
      sharedWith: { $in: [session.user.email, session.user.id] },
      isRevoked: false,
    })
      .populate("objectId", "key size contentType isEncrypted encryptedName thumbnail")
      .populate("bucketId", "name")
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ shareLinks: links });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
