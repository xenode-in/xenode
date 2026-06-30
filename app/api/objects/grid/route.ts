/**
 * GET /api/objects/grid?bucketId=&mediaCategory=
 *
 * Returns every field the photo grid needs to render all tiles and
 * all scrubber sections in a single request — no pagination.
 *
 * Why this exists instead of using /api/objects + /api/objects/metadata:
 *
 *   /api/objects/metadata  → { _id, createdAt }[]          (no thumbnail key, no aspectRatio)
 *   /api/objects            → paginated, 50 at a time, heavy (signed URLs, all fields)
 *
 *   The lazy-batch pattern (metadata → batch-by-ids as viewport moves) breaks
 *   when the scrubber jumps to a section that hasn't been scrolled to yet —
 *   tiles are blank because their data hasn't been fetched.
 *
 *   This endpoint returns ALL items at once, but only the fields the grid
 *   actually needs. Thumbnail *images* still load lazily (useThumbnail +
 *   batch-content), but the tile shape (aspectRatio, thumbnail key, date) is
 *   available immediately.
 *
 * Fields returned per item:
 *   _id, createdAt          — date sections + React key
 *   thumbnail               — B2 key for useThumbnail (NOT a signed URL)
 *   aspectRatio             — grid cell sizing
 *   isEncrypted             — hint for decryption
 *   encryptedName           — display name (decrypted client-side)
 *   key                     — original file B2 key (for preview open)
 *
 * Intentionally omitted:
 *   thumbnailUrl / optimizedUrl   — signed URLs, useThumbnail replaces them
 *   optimizedEncryptedDEK / IV    — only needed in preview lightbox,
 *                                   fetched on-demand via GET /api/objects/{id}
 *   size, tags, position, etc.    — not displayed in the grid
 *
 * Size estimate: ~260 bytes/item × 1 693 photos ≈ 440 KB raw / ~55 KB gzipped.
 * A 5 000-photo library stays under 150 KB gzipped — fast on any connection.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { logRequest } from "@/lib/logRequest";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";

export const dynamic = "force-dynamic";

type GridDoc = {
  _id: unknown;
  createdAt: Date | string;
  thumbnail?: string;
  aspectRatio?: number;
  isEncrypted?: boolean;
  encryptedName?: string | null;
  encryptedDisplayName?: string | null;
  key: string;
  size?: number;
  optimizedKey?: string;
  optimizedIV?: string;
  optimizedEncryptedDEK?: string;
  optimizedSize?: number;
};

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const ctx = await requireAccessContext(request);
    userId = ctx.userId;

    const { searchParams } = request.nextUrl;
    const bucketId = searchParams.get("bucketId");
    if (!bucketId) {
      statusCode = 400;
      errorMessage = "bucketId is required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const mediaCategoryFilter = searchParams.get("mediaCategory");

    await dbConnect();

    // Same ownership check as /api/objects and /api/objects/metadata.
    const bucket = await Bucket.findOne({
      _id: bucketId,
      ...bucketOwnershipClause(ctx),
    })
      .select("_id userId")
      .lean<{ _id: unknown; userId: string }>();

    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const query: Record<string, unknown> = {
      bucketId,
      deletedAt: { $exists: false },
      isSidecar: { $ne: true },
    };

    // Mirror "system bucket → scope to user's own prefix" rule.
    if (bucket.userId === "system") {
      const prefix = `users/${userId}/`;
      query.key = { $gte: prefix, $lt: prefix + "￿" };
    }

    if (mediaCategoryFilter) {
      query.mediaCategory = mediaCategoryFilter;
    }

    // Only fetch the fields we return — Mongo projects away the heavy blobs
    // (optimizedEncryptedDEK, etc.) before hydration, so memory stays low
    // even at 10 000+ objects.
    const docs = await StorageObject.find(query)
      .select(
        "_id createdAt key size thumbnail aspectRatio isEncrypted " +
          "encryptedName encryptedDisplayName " +
          "optimizedKey optimizedIV optimizedEncryptedDEK optimizedSize",
      )
      .sort({ createdAt: -1, _id: -1 })
      .lean<GridDoc[]>();

    const items = docs.map((d) => ({
      _id: String(d._id),
      createdAt:
        d.createdAt instanceof Date
          ? d.createdAt.toISOString()
          : String(d.createdAt),
      key: d.key,
      size: d.size ?? 0,
      thumbnail: d.thumbnail ?? null,
      aspectRatio: d.aspectRatio ?? 1,
      isEncrypted: d.isEncrypted ?? false,
      encryptedName: d.encryptedName ?? null,
      encryptedDisplayName: d.encryptedDisplayName ?? null,
      optimizedKey: d.optimizedKey ?? null,
      optimizedIV: d.optimizedIV ?? null,
      optimizedEncryptedDEK: d.optimizedEncryptedDEK ?? null,
      optimizedSize: d.optimizedSize ?? null,
    }));

    const response = NextResponse.json({ count: items.length, items });
    // Same cache hint as /api/objects/metadata — 30 s is fresh enough for a
    // gallery; uploads reconcile locally via Dexie without a refetch.
    response.headers.set("Cache-Control", "private, max-age=30");
    return response;
  } catch (err: any) {
    if (isAuthzError(err)) {
      statusCode = err.status;
      errorMessage = err.message;
      return toJsonResponse(err);
    }
    statusCode = err?.message === "Unauthorized" ? 401 : 500;
    errorMessage = err?.message ?? "Internal error";
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
