import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import ShareLink from "@/models/ShareLink";

export const dynamic = "force-dynamic";

/** GET /api/share/shared-with-me — List share links shared with current user */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    await dbConnect();
    const recipients = [ctx.session.user.email, ctx.userId].filter(
      (identifier): identifier is string => typeof identifier === "string" && !!identifier,
    );

    const links = await ShareLink.find({
      sharedWith: { $in: recipients },
      isRevoked: false,
    })
      .populate("objectId", "key size contentType isEncrypted encryptedName thumbnail")
      .populate("bucketId", "name")
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ shareLinks: links });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
