import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/b2/client";
import { verifyFileToken } from "@/lib/b2/cdn";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ bucket: string; key: string[] }>;
}

/**
 * GET /api/files/[bucket]/[...key]?exp=<unix>&sig=<hmac>
 *
 * Validates a short-lived signed token, then streams the private B2 object
 * directly to the client. Azure CDN caches the response using the URL
 * (including the token) as the cache key.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { bucket, key: keyParts } = await params;
  const key = keyParts.join("/");

  const exp = request.nextUrl.searchParams.get("exp");
  const sig = request.nextUrl.searchParams.get("sig");

  if (!exp || !sig) {
    return new NextResponse("Missing token parameters", { status: 400 });
  }

  const expNum = parseInt(exp, 10);
  if (isNaN(expNum)) {
    return new NextResponse("Invalid expiry", { status: 400 });
  }

  if (!verifyFileToken(bucket, key, expNum, sig)) {
    return new NextResponse("Invalid or expired token", { status: 403 });
  }

  try {
    const rangeHeader = request.headers.get("range");
    const command = new GetObjectCommand({ 
      Bucket: bucket, 
      Key: key,
      ...(rangeHeader ? { Range: rangeHeader } : {})
    });
    const response = await getS3Client().send(command);

    if (!response.Body) {
      return new NextResponse("File not found", { status: 404 });
    }

    // Convert the B2 stream to a Web ReadableStream
    const stream = response.Body.transformToWebStream();

    const headers = new Headers();

    if (response.ContentType) {
      headers.set("Content-Type", response.ContentType);
    }
    if (response.ContentLength) {
      headers.set("Content-Length", String(response.ContentLength));
    }
    if (response.ContentDisposition) {
      headers.set("Content-Disposition", response.ContentDisposition);
    }
    if (response.ContentRange) {
      headers.set("Content-Range", response.ContentRange);
    }
    headers.set("Accept-Ranges", "bytes");

    // Allow Azure CDN to cache responses for up to 1 hour at the edge.
    // The short-lived token in the URL means stale cache entries are harmless
    // (they'll 403 on re-validation once the token expires).
    headers.set("Cache-Control", "public, max-age=3600, s-maxage=3600");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    const status = response.ContentRange ? 206 : 200;

    return new NextResponse(stream, { status, headers });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error(`[CDN Proxy] Failed to stream ${bucket}/${key}:`, message);
    return new NextResponse("Failed to fetch file", { status: 502 });
  }
}

export async function OPTIONS() {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return new NextResponse(null, { status: 204, headers });
}
