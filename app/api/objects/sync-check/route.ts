/**
 * POST /api/objects/sync-check
 *
 * The mobile backup engine's dedup probe. Given a batch of opaque per-user
 * fingerprints, returns which ones already exist as (non-deleted) objects in
 * the bucket. This replaces the old approach of downloading + decrypting every
 * cloud filename on the device just to diff against the camera roll.
 *
 * Body:  { bucketId: string, kind: "content" | "meta", fingerprints: string[] }
 * Reply: { matches: { fp: string, id: string }[] }
 *        // one entry per input fingerprint that already exists, carrying the
 *        // existing object's id so the device can collapse the local copy and
 *        // its cloud twin in the gallery (important after a reinstall, where
 *        // the local↔cloud map was lost).
 *
 * `kind` selects which fingerprint column to match:
 *   - "content" → syncContentFp (authoritative, HMAC of the file bytes)
 *   - "meta"    → syncMetaFp    (cheap pre-filter, HMAC of size/dims/time)
 *
 * The query is an `$in` over a sparse compound index ({bucketId, syncXFp}),
 * projected to just that one field — Mongo satisfies it from the index alone.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";

export const dynamic = "force-dynamic";

// Keep batches bounded so a single request can't fan out into a huge $in.
// The client splits larger sets across multiple calls.
const MAX_FINGERPRINTS = 1000;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    const userId = ctx.userId;

    const body = await request.json();
    const bucketId: unknown = body?.bucketId;
    const kind: unknown = body?.kind;
    const fingerprints: unknown = body?.fingerprints;

    if (typeof bucketId !== "string" || !bucketId) {
      return NextResponse.json(
        { error: "Bucket ID is required" },
        { status: 400 },
      );
    }
    if (kind !== "content" && kind !== "meta") {
      return NextResponse.json(
        { error: "kind must be 'content' or 'meta'" },
        { status: 400 },
      );
    }
    if (!Array.isArray(fingerprints)) {
      return NextResponse.json(
        { error: "fingerprints must be an array" },
        { status: 400 },
      );
    }
    if (fingerprints.length > MAX_FINGERPRINTS) {
      return NextResponse.json(
        { error: `Too many fingerprints (max ${MAX_FINGERPRINTS})` },
        { status: 400 },
      );
    }

    // De-dupe + drop non-strings before hitting the DB.
    const wanted = Array.from(
      new Set(fingerprints.filter((f): f is string => typeof f === "string" && f.length > 0)),
    );
    if (wanted.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    await dbConnect();

    // Ownership check — mirrors /api/objects and /api/objects/metadata.
    const bucket = await Bucket.findOne({
      _id: bucketId,
      ...bucketOwnershipClause(ctx),
    })
      .select("_id userId")
      .lean<{ _id: unknown; userId: string }>();

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    const field = kind === "content" ? "syncContentFp" : "syncMetaFp";

    const query: Record<string, unknown> = {
      bucketId,
      deletedAt: { $exists: false },
      [field]: { $in: wanted },
    };

    // System buckets are shared — scope to the caller's own prefix so one
    // user can't probe another's fingerprints. Matches the metadata route.
    if (bucket.userId === "system") {
      const prefix = `users/${userId}/`;
      query.key = { $gte: prefix, $lt: prefix + "￿" };
    }

    const docs = await StorageObject.find(query)
      .select(`${field} _id`)
      .lean<Array<{ _id: unknown } & Record<string, string>>>();

    // One match per fingerprint. If several objects share a fingerprint (a
    // genuine duplicate already in the cloud) the first is enough — the device
    // only needs to know it exists and pick one cloud twin to collapse against.
    const seen = new Set<string>();
    const matches: { fp: string; id: string }[] = [];
    for (const d of docs) {
      const fp = d[field];
      if (!fp || seen.has(fp)) continue;
      seen.add(fp);
      matches.push({ fp, id: String(d._id) });
    }

    return NextResponse.json({ matches });
  } catch (err) {
    if (isAuthzError(err)) {
      return toJsonResponse(err);
    }
    const message = err instanceof Error ? err.message : "Internal error";
    const statusCode = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
