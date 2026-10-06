import { NextRequest, NextResponse } from "next/server";
import { getAccessContext, isAuthzError, toJsonResponse } from "@/lib/authz";
import { getSignedFileUrl } from "@/lib/b2/cdn";
import { resolveThumbnailAccess } from "@/lib/storage/shareBucket";
import dbConnect from "@/lib/mongodb";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const ctx = await getAccessContext(request);
    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.keys) || body.keys.length > 50 || body.keys.some((key: unknown) => typeof key !== "string" || !key || key.length > 1024)) return NextResponse.json({ error: "Invalid thumbnail batch" }, { status: 400 });
    await dbConnect();
    const urls: Record<string, string> = {};
    for (const key of new Set<string>(body.keys)) {
      const access = await resolveThumbnailAccess(key, ctx);
      if (access) urls[key] = await getSignedFileUrl(access.bucket.b2BucketId, key, access.expiresIn);
    }
    return NextResponse.json({ urls }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return isAuthzError(error) ? toJsonResponse(error) : NextResponse.json({ error: "Could not sign thumbnails" }, { status: 503 });
  }
}
