import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { getDownloadUrl } from "@/lib/b2/objects";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/objects/[id]/content
 *
 * Proxy-fetches the raw file bytes from B2/CDN and streams them back to the
 * browser with permissive CORS headers.  Used exclusively for encrypted files
 * so that `fetch()` in FilePreviewDialog doesn't get blocked by CORS (the CDN
 * does not send Access-Control-Allow-Origin).
 *
 * Auth is checked server-side, so the signed CDN URL is never exposed to a
 * different origin and the ciphertext is only forwarded to the owning user.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    const { id } = await params;

    await dbConnect();

    // Verify ownership
    const object = await StorageObject.findOne({ _id: id, userId });
    if (!object) {
      return NextResponse.json({ error: "Object not found" }, { status: 404 });
    }

    if (!object.isEncrypted) {
      // Only proxy encrypted files — plaintext uses the direct CDN URL
      return NextResponse.json(
        { error: "Not an encrypted object" },
        { status: 400 },
      );
    }

    const bucket = await Bucket.findOne({ _id: object.bucketId });
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    // Get a fresh signed URL and fetch the ciphertext server-side
    const signedUrl = await getDownloadUrl(bucket.b2BucketId, object.key);
    const upstream = await fetch(signedUrl);

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Failed to fetch file from storage" },
        { status: 502 },
      );
    }

    // Stream the response back with same-origin CORS headers
    const headers = new Headers();
    headers.set(
      "Content-Type",
      upstream.headers.get("Content-Type") ?? "application/octet-stream",
    );
    const contentLength = upstream.headers.get("Content-Length");
    if (contentLength) headers.set("Content-Length", contentLength);
    // Allow the browser (same origin) to read the response body
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "private, no-store");

    return new NextResponse(upstream.body, {
      status: 200,
      headers,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
