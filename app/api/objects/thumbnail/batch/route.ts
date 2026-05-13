/**
 * POST /api/objects/thumbnail/batch
 *
 * Accepts a list of B2 thumbnail keys and returns a time-windowed HMAC
 * proxy URL for each one. The browser then downloads the thumbnails
 * directly via GET /api/files/[bucket]/[...key], which streams bytes
 * from B2 and is cacheable by Azure CDN / Cloudflare.
 *
 * This is intentionally a pure signing endpoint — no B2 I/O happens
 * here. HMAC generation for 50 keys takes ~5ms.
 *
 * Body:     { keys: string[] }          (max 50)
 * Response: { urls: { [key]: string } } (HMAC proxy URLs, same within 1h window)
 *
 * Security: keys are filtered to `users/{userId}/` (own files) or
 * `shares/` (public shares) before signing — callers cannot request
 * arbitrary B2 keys.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { getSignedFileUrl } from "@/lib/b2/cdn";
import { logRequest } from "@/lib/logRequest";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";

export const dynamic = "force-dynamic";

const MAX_KEYS = 50;

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    // Auth is optional — unauthenticated callers can only sign shares/ keys.
    try {
      userId = (await requireAuth(request)).user.id;
    } catch {
      /* unauthenticated — shares/ only */
    }

    const body = await request.json().catch(() => ({}));
    const keys: string[] = Array.isArray(body?.keys) ? body.keys : [];

    // Security: restrict to keys the caller is allowed to read.
    const allowed = keys
      .filter(
        (k) =>
          typeof k === "string" &&
          (k.startsWith("shares/") ||
            (userId && k.startsWith(`users/${userId}/`))),
      )
      .slice(0, MAX_KEYS);

    if (allowed.length === 0) {
      return NextResponse.json({ urls: {} });
    }

    await dbConnect();

    // Resolve b2BucketId for HMAC URL construction.
    const bucket = await Bucket.findOne({
      $or: userId ? [{ userId }, { userId: "system" }] : [{ userId: "system" }],
    })
      .select("b2BucketId")
      .lean<{ b2BucketId: string }>();

    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    // Pure HMAC signing — ~0.1ms per URL, no network I/O.
    const urls: Record<string, string> = {};
    for (const key of allowed) {
      urls[key] = getSignedFileUrl(bucket.b2BucketId, key);
    }

    return NextResponse.json({ urls });
  } catch (err: any) {
    statusCode = 500;
    errorMessage = err?.message ?? "Internal error";
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
