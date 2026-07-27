import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/b2/client";
import { regionForBucketName } from "@xenode/config/storage";
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
  const version = request.nextUrl.searchParams.get("v") || "";

  if (!exp || !sig) {
    return new NextResponse("Missing token parameters", { status: 400 });
  }

  const expNum = parseInt(exp, 10);
  if (isNaN(expNum)) {
    return new NextResponse("Invalid expiry", { status: 400 });
  }

  if (!verifyFileToken(bucket, key, expNum, sig, version)) {
    return new NextResponse("Invalid or expired token", { status: 403 });
  }

  try {
    const rangeHeader = request.headers.get("range");
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(rangeHeader ? { Range: rangeHeader } : {})
    });
    // No session here (token-signed): resolve the region from the bucket name
    // baked into the signed URL so we use the matching regional client.
    const response = await getS3Client(regionForBucketName(bucket)).send(command);

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
    // Missing object → clean, fast 404. This is expected for "zombie" Bin
    // entries whose blobs were already purged (e.g. items deleted before blob
    // retention existed, or after the 30-day purge), so don't log it as an
    // error or 502 — the client just shows a placeholder.
    const err = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    const status = err?.$metadata?.httpStatusCode;
    if (err?.name === "NoSuchKey" || err?.name === "NotFound" || status === 404) {
      return new NextResponse("File not found", { status: 404 });
    }

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
