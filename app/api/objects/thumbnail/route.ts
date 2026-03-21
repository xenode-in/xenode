import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { getDownloadUrl } from "@/lib/b2/objects";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Authentication is optional for shared thumbnails (shares/ prefix)
    let userId: string | null = null;
    try {
      const session = await requireAuth(request);
      userId = session.user.id;
    } catch {
      // Not logged in — that's okay for shares
    }

    const key = request.nextUrl.searchParams.get("key");

    if (!key) {
      return NextResponse.json({ error: "Missing key" }, { status: 400 });
    }

    // Security: ensure key belongs to requesting user, unless it's a share
    if (key.startsWith("shares/")) {
      // Allow shares/ prefix for everyone (it's encrypted anyway)
    } else if (userId && key.startsWith(`users/${userId}/`)) {
      // Allow user's own files
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await dbConnect();
    
    // Find the system bucket or any bucket if it's a share
    // In our system, all public/shared files are in the same B2 bucket usually,
    // or we can just find any bucket since they share the same B2 credentials.
    const bucket = await Bucket.findOne({
      $or: userId ? [{ userId }, { userId: "system" }] : [{ userId: "system" }],
    });

    if (!bucket) {
      return NextResponse.json({ error: "Storage bucket not found" }, { status: 404 });
    }

    const url = await getDownloadUrl(bucket.b2BucketId, key, 3600);
    return NextResponse.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
