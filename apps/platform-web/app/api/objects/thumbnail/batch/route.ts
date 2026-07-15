/**
 * POST /api/objects/thumbnail/batch
 *
 * Accepts a list of B2 thumbnail keys and returns a time-windowed HMAC
 * proxy URL for each one. The browser then downloads the thumbnails
 * directly via GET /api/files/[bucket]/[...key], which streams bytes
 * from B2 and is cacheable by Azure CDN / Cloudflare.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  getAccessContext,
  isAuthzError,
  toJsonResponse,
} from "@/lib/authz";
import { getSignedFileUrl } from "@/lib/b2/cdn";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import { orgObjectKeyPrefix, teamObjectKeyPrefix } from "@/lib/orgs/storage";

export const dynamic = "force-dynamic";

const MAX_KEYS = 50;

export async function POST(request: NextRequest) {
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    let userId: string | null = null;
    let ctx = null;
    try {
      ctx = await getAccessContext(request);
      userId = ctx?.userId ?? null;
    } catch {
      // Unauthenticated callers can still sign shares/ keys.
    }

    const body = await request.json().catch(() => ({}));
    const keys: string[] = Array.isArray(body?.keys) ? body.keys : [];

    const workspacePrefix =
      ctx?.spaceType === "organization"
        ? orgObjectKeyPrefix(ctx.organizationId!)
        : ctx?.spaceType === "team"
          ? teamObjectKeyPrefix(ctx.organizationId!, ctx.teamId!)
          : null;

    const allowed = keys
      .filter(
        (key) =>
          typeof key === "string" &&
          (key.startsWith("shares/") ||
            (userId && key.startsWith(`users/${userId}/`)) ||
            (workspacePrefix && key.startsWith(workspacePrefix))),
      )
      .slice(0, MAX_KEYS);

    if (allowed.length === 0) {
      return NextResponse.json({ urls: {} });
    }

    await dbConnect();

    const hasScopedKeys = allowed.some(
      (key) =>
        (userId && key.startsWith(`users/${userId}/`)) ||
        (workspacePrefix && key.startsWith(workspacePrefix)),
    );
    const bucket = await Bucket.findOne(
      ctx && hasScopedKeys ? bucketOwnershipClause(ctx) : { userId: "system" },
    )
      .select("b2BucketId")
      .lean<{ b2BucketId: string }>();

    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const urls: Record<string, string> = {};
    for (const key of allowed) {
      urls[key] = getSignedFileUrl(bucket.b2BucketId, key);
    }

    return NextResponse.json({ urls });
  } catch (err: any) {
    if (isAuthzError(err)) {
      statusCode = err.status;
      errorMessage = err.message;
      return toJsonResponse(err);
    }
    statusCode = 500;
    errorMessage = err?.message ?? "Internal error";
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
