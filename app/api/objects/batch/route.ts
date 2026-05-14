/**
 * POST /api/objects/batch
 * Body: { bucketId: string, ids: string[] }
 *
 * Returns the full LIST_PROJECTION-equivalent shape (with pre-signed
 * thumbnail + optimized URLs) for the IDs the caller asks for — and
 * nothing else. Paired with /api/objects/metadata to enable strict
 * viewport-driven lazy loading:
 *
 *   1. Client fetches /api/objects/metadata once → gets every
 *      { _id, createdAt }, lays out empty grid slots + populates
 *      the scrubber.
 *   2. As rows enter the viewport (IntersectionObserver), client
 *      collects the visible IDs and POSTs them here in one batch.
 *   3. Response is keyed by id; client merges into its cache and
 *      renders thumbnails.
 *
 * Why POST? Two reasons:
 *   - IDs are a list of MongoDB ObjectIds (24 chars each). A typical
 *     viewport batch is ~30 IDs ≈ ~720 chars, fine for a URL today,
 *     but bulk-prefetch or large screens can blow past the 2 KB GET
 *     limit on some proxies.
 *   - We don't want this to be cached as a GET — the response embeds
 *     short-TTL pre-signed URLs (~10 min). Forcing POST sidesteps
 *     accidental CDN caching.
 *
 * Batch size cap: 200 IDs per request. The gallery should never need
 * more than a few dozen at once (viewport-driven), and the cap
 * protects against accidental "request 5000 in one shot".
 */

import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";

import { requireAuth } from "@/lib/auth/session";
import { getSignedFileUrl } from "@/lib/b2/cdn";
import { logRequest } from "@/lib/logRequest";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";

export const dynamic = "force-dynamic";

const MAX_BATCH = 200;

// Same projection the listing endpoint uses, so the client can drop
// these into the same cache slot without shape mismatches.
const LIST_PROJECTION =
  "key size contentType encryptedContentType thumbnail tags position createdAt " +
  "isEncrypted encryptedName encryptedDisplayName mediaCategory " +
  "optimizedKey optimizedEncryptedDEK optimizedIV optimizedSize aspectRatio";

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const session = await requireAuth(request);
    userId = session.user.id;

    let body: { bucketId?: string; ids?: string[] };
    try {
      body = await request.json();
    } catch {
      statusCode = 400;
      errorMessage = "Invalid JSON body";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const bucketId = body.bucketId;
    const rawIds = Array.isArray(body.ids) ? body.ids : [];

    if (!bucketId) {
      statusCode = 400;
      errorMessage = "bucketId is required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    if (rawIds.length === 0) {
      // Empty batch is a valid no-op — return empty result. Avoids the
      // client having to short-circuit when its viewport is empty.
      return NextResponse.json({ items: {} });
    }
    if (rawIds.length > MAX_BATCH) {
      statusCode = 400;
      errorMessage = `Batch size ${rawIds.length} exceeds max ${MAX_BATCH}`;
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    // Filter to syntactically-valid ObjectIds before hitting Mongo so a
    // malformed ID in the input doesn't blow up the whole batch.
    const objectIds = rawIds
      .filter((id) => typeof id === "string" && Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    if (objectIds.length === 0) {
      return NextResponse.json({ items: {} });
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      $or: [{ userId }, { userId: "system" }],
    })
      .select("_id userId b2BucketId")
      .lean<{ _id: unknown; userId: string; b2BucketId: string }>();

    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const query: Record<string, unknown> = {
      _id: { $in: objectIds },
      bucketId,
      deletedAt: { $exists: false },
      isSidecar: { $ne: true },
    };

    if (bucket.userId === "system") {
      const prefix = `users/${userId}/`;
      query.key = { $gte: prefix, $lt: prefix + "￿" };
    }

    const docs = await StorageObject.find(query)
      .select(LIST_PROJECTION)
      .lean<Array<Record<string, any>>>();

    // Sign URLs in parallel. Two URLs per object (thumbnail + optimized)
    // so this is the dominant latency contributor — ~10-30ms each via
    // the B2 SDK. With Promise.all and a 30-item batch we're sub-100ms
    // wall-clock.
    const signed = await Promise.all(
      docs.map(async (doc) => {
        const id = String(doc._id);

        let thumbnailUrl: string | null = null;
        if (doc.thumbnail) {
          try {
            thumbnailUrl = await getSignedFileUrl(
              bucket.b2BucketId,
              doc.thumbnail,
            );
          } catch {
            // Non-fatal — thumbnail just won't render; client falls back
            // to placeholder.
          }
        }

        let optimizedUrl: string | null = null;
        if (doc.optimizedKey) {
          try {
            optimizedUrl = await getSignedFileUrl(
              bucket.b2BucketId,
              doc.optimizedKey,
            );
          } catch {}
        }

        return [
          id,
          {
            ...doc,
            _id: id,
            thumbnailUrl,
            optimizedUrl,
          },
        ] as const;
      }),
    );

    // Returned as an object keyed by id so the client can do O(1)
    // lookups when merging into its cache, and gracefully ignores IDs
    // the server dropped (deleted, wrong bucket, malformed).
    const items: Record<string, any> = {};
    for (const [id, doc] of signed) items[id] = doc;

    return NextResponse.json({ items });
  } catch (err: any) {
    statusCode = err?.message === "Unauthorized" ? 401 : 500;
    errorMessage = err?.message ?? "Internal error";
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
