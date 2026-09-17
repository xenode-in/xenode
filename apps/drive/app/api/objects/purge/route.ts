/**
 * POST /api/objects/purge
 *
 * Permanently delete binned objects — "Delete forever" on a selection, or
 * "Empty Bin" for everything. This is where the encrypted B2 blobs are finally
 * removed and storage quota is freed; the same work the /api/cron/purge-bin job
 * does on a 30-day timer, but on demand for the caller's own bucket.
 *
 * Body:  { bucketId: string, ids?: string[], all?: boolean }
 *          - ids:  purge these binned objects (+ their sidecars)
 *          - all:  purge EVERYTHING currently in this bucket's bin
 * Reply: { success: true, purgedCount }
 *
 * Only operates on already-binned objects (deletedAt set). Live objects are
 * never touched, so this can't be used to skip the bin.
 */

import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import {
  requireAccessContext,
  bucketOwnershipClause,
  objectOwnershipClause,
} from "@/lib/authz";
import { logRequest } from "@/lib/logRequest";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject, { type IStorageObjectVersion } from "@/models/StorageObject";
import {
  versionsTotalBytes,
} from "@/lib/storage/versions";
import { collectStorageObjectKeys } from "@/lib/storage/object-keys";
import ShareLink from "@/models/ShareLink";
import DirectShare from "@/models/DirectShare";
import { removeObjectsFromAlbums } from "@/lib/albums/cleanup";
import { deleteObjects as deleteB2Objects } from "@/lib/b2/objects";
import { decrementStorageBulk, updateBucketStats } from "@/lib/metering/usage";
import { enforceStorageAccess } from "@/lib/subscriptions/service";
import { decrementOrgStorage } from "@/lib/orgs/billing/orgUsage";

export const dynamic = "force-dynamic";

const MAX_IDS = 10000;

type PurgeDoc = {
  _id: Types.ObjectId;
  key?: string;
  thumbnail?: string;
  optimizedKey?: string;
  size?: number;
  versions?: IStorageObjectVersion[];
  chunks?: Array<{ key: string }>;
};

const PURGE_PROJECTION = "_id key thumbnail optimizedKey size versions chunks";

function collectB2Keys(docs: PurgeDoc[]): string[] {
  return docs.flatMap(collectStorageObjectKeys);
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const ctx = await requireAccessContext(request);
    userId = ctx.userId;
    await enforceStorageAccess(userId);

    let body: { bucketId?: unknown; ids?: unknown; all?: unknown };
    try {
      body = await request.json();
    } catch {
      statusCode = 400;
      errorMessage = "Invalid JSON";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const bucketId = body.bucketId;
    const all = body.all === true;

    if (typeof bucketId !== "string" || !bucketId) {
      statusCode = 400;
      errorMessage = "bucketId is required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    let ids: string[] = [];
    if (!all) {
      if (!Array.isArray(body.ids)) {
        statusCode = 400;
        errorMessage = "Provide ids[] or all:true";
        return NextResponse.json(
          { error: errorMessage },
          { status: statusCode },
        );
      }
      ids = Array.from(
        new Set(
          body.ids.filter((x): x is string => typeof x === "string" && !!x),
        ),
      );
      if (ids.length === 0) {
        return NextResponse.json({ success: true, purgedCount: 0 });
      }
      if (ids.length > MAX_IDS) {
        statusCode = 400;
        errorMessage = `Too many ids (max ${MAX_IDS} per request)`;
        return NextResponse.json(
          { error: errorMessage },
          { status: statusCode },
        );
      }
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      ...bucketOwnershipClause(ctx),
    })
      .select("_id b2BucketId")
      .lean<{ _id: unknown; b2BucketId: string }>();

    if (!bucket) {
      statusCode = 404;
      errorMessage = "Bucket not found";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    // Gather the docs to purge — only ones already in the bin.
    let docs: PurgeDoc[];
    if (all) {
      // Empty bin: every binned doc in this bucket (primaries + sidecars).
      docs = await StorageObject.find({
        bucketId,
        ...objectOwnershipClause(ctx),
        deletedAt: { $exists: true },
      })
        .select(PURGE_PROJECTION)
        .lean<PurgeDoc[]>();
    } else {
      const primaries = await StorageObject.find({
        _id: { $in: ids },
        bucketId,
        ...objectOwnershipClause(ctx),
        deletedAt: { $exists: true },
      })
        .select(PURGE_PROJECTION)
        .lean<PurgeDoc[]>();

      if (primaries.length === 0) {
        return NextResponse.json({ success: true, purgedCount: 0 });
      }

      // Recursively gather children of folders to purge
      const folderPrefixes: string[] = [];
      primaries.forEach((p) => {
        if (p.key && p.key.endsWith("/")) {
          folderPrefixes.push(p.key);
        }
      });

      let allDocs = [...primaries];

      if (folderPrefixes.length > 0) {
        const folderChildren = await StorageObject.find({
          bucketId,
          ...objectOwnershipClause(ctx),
          deletedAt: { $exists: true },
          $or: folderPrefixes.map((prefix) => ({
            key: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` }
          }))
        })
          .select(PURGE_PROJECTION)
          .lean<PurgeDoc[]>();

        allDocs = [...allDocs, ...folderChildren];
      }

      const sidecars = await StorageObject.find({
        parentObjectId: { $in: allDocs.map((p) => p._id) },
        ...objectOwnershipClause(ctx),
        deletedAt: { $exists: true },
      })
        .select(PURGE_PROJECTION)
        .lean<PurgeDoc[]>();

      docs = [...allDocs, ...sidecars];
    }

    if (docs.length === 0) {
      return NextResponse.json({ success: true, purgedCount: 0 });
    }

    docs = [...new Map(docs.map((doc) => [String(doc._id), doc])).values()];
    const allDocIds = docs.map((d) => d._id);

    // 1. Confirm encrypted blob deletion before discarding the metadata.
    await deleteB2Objects(bucket.b2BucketId, collectB2Keys(docs));

    // 2. Hard-delete the documents.
    await StorageObject.deleteMany({ _id: { $in: allDocIds } });

    // 3. Belt-and-suspenders share cleanup (normally already revoked at bin).
    await ShareLink.deleteMany({ objectId: { $in: allDocIds } });
    await DirectShare.deleteMany({ objectId: { $in: allDocIds } });
    await removeObjectsFromAlbums(ctx.spaceId, userId, allDocIds);

    // 4. Now — and only now — free the storage these bytes occupied.
    const totalSize = docs.reduce(
      (sum, d) => sum + (d.size || 0) + versionsTotalBytes(d.versions ?? []),
      0,
    );
    if (ctx.spaceType === "personal") {
      await decrementStorageBulk(userId, totalSize, allDocIds.length);
    } else {
      await decrementOrgStorage(ctx.organizationId!, totalSize, allDocIds.length);
    }
    await updateBucketStats(String(bucket._id), -allDocIds.length, -totalSize);

    return NextResponse.json({ success: true, purgedCount: allDocIds.length });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      statusCode = 401;
      errorMessage = "Unauthorized";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    if (error instanceof Error && error.name === "SubscriptionRequired") {
      statusCode = 402;
      errorMessage = "Active subscription required";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    statusCode = 500;
    errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  } finally {
    logRequest({
      userId,
      method: request.method,
      endpoint: request.nextUrl.pathname,
      statusCode,
      durationMs: Date.now() - startTime,
      ip: request.headers.get("x-forwarded-for") || "unknown",
      userAgent: request.headers.get("user-agent") || "unknown",
      errorMessage,
    });
  }
}
