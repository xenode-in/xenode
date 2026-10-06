import { NextRequest, NextResponse } from "next/server";
import { getAccessContext, isAuthzError, toJsonResponse } from "@/lib/authz";
import { getSignedFileUrl } from "@/lib/b2/cdn";
import { resolveThumbnailAccess } from "@/lib/storage/shareBucket";
import dbConnect from "@/lib/mongodb";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const key = request.nextUrl.searchParams.get("key");
    if (!key || key.length > 1024) return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    const ctx = await getAccessContext(request);
    await dbConnect();
    const access = await resolveThumbnailAccess(key, ctx);
    if (!access) return NextResponse.json({ error: "Thumbnail unavailable" }, { status: 404 });
    const url = await getSignedFileUrl(access.bucket.b2BucketId, key, access.expiresIn);
    return NextResponse.json({ url }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return isAuthzError(error) ? toJsonResponse(error) : NextResponse.json({ error: "Could not sign thumbnail" }, { status: 503 });
  }
}
