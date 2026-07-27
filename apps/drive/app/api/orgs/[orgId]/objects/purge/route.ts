import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { orgObjectClause, requireOrgStorageMembership } from "@/lib/orgs/storage";
import { systemWorkspaceBucketName } from "@/lib/storage/workspaceBucket";
import {
  collectVersionB2Keys,
  versionsTotalBytes,
} from "@/lib/storage/versions";
import { deleteObjects as deleteB2Objects } from "@/lib/b2/objects";
import StorageObject, { type IStorageObjectVersion } from "@/models/StorageObject";
import OrgUsage from "@/models/OrgUsage";
import ShareLink from "@/models/ShareLink";
import DirectShare from "@/models/DirectShare";
import { resolveOrgStorageRegion } from "@/lib/storage/region";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

const MAX_IDS = 5000;
const PURGE_PROJECTION = "_id key thumbnail optimizedKey size versions";

type PurgeDoc = {
  _id: Types.ObjectId;
  key?: string;
  thumbnail?: string;
  optimizedKey?: string;
  size?: number;
  versions?: IStorageObjectVersion[];
};

function collectB2Keys(docs: PurgeDoc[]): string[] {
  const keys: string[] = [];
  for (const d of docs) {
    if (d.key) keys.push(d.key);
    if (d.thumbnail) keys.push(d.thumbnail);
    if (d.optimizedKey) keys.push(d.optimizedKey);
    for (const v of d.versions ?? []) keys.push(...collectVersionB2Keys(v));
  }
  return keys;
}

/**
 * POST /api/orgs/[orgId]/objects/purge — permanently delete binned org objects
 * ("Delete forever" on a selection, or "Empty bin" with `all:true`). Removes the
 * encrypted B2 blobs, hard-deletes the docs, cleans up shares, and frees the
 * org's storage (OrgUsage). Admin/owner only. Only touches already-binned docs.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await requireOrgStorageMembership({ userId: ctx.userId, orgId, action: "delete" });

    const body = (await request.json().catch(() => ({}))) as {
      ids?: unknown;
      all?: unknown;
    };
    const all = body.all === true;

    await dbConnect();

    let docs: PurgeDoc[];
    if (all) {
      docs = await StorageObject.find({
        ...orgObjectClause(orgId),
        deletedAt: { $exists: true },
      })
        .select(PURGE_PROJECTION)
        .lean<PurgeDoc[]>();
    } else {
      if (!Array.isArray(body.ids)) {
        return NextResponse.json(
          { error: "Provide ids[] or all:true" },
          { status: 400 },
        );
      }
      const ids = Array.from(
        new Set(body.ids.filter((x): x is string => typeof x === "string" && !!x)),
      ).slice(0, MAX_IDS);
      if (ids.length === 0) {
        return NextResponse.json({ success: true, purgedCount: 0 });
      }

      const primaries = await StorageObject.find({
        _id: { $in: ids },
        ...orgObjectClause(orgId),
        deletedAt: { $exists: true },
      })
        .select(PURGE_PROJECTION)
        .lean<PurgeDoc[]>();
      if (primaries.length === 0) {
        return NextResponse.json({ success: true, purgedCount: 0 });
      }

      let allDocs = [...primaries];
      const folderPrefixes = primaries
        .filter((p) => p.key && p.key.endsWith("/"))
        .map((p) => p.key as string);
      if (folderPrefixes.length > 0) {
        const children = await StorageObject.find({
          ...orgObjectClause(orgId),
          deletedAt: { $exists: true },
          $or: folderPrefixes.map((prefix) => ({
            key: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` },
          })),
        })
          .select(PURGE_PROJECTION)
          .lean<PurgeDoc[]>();
        allDocs = allDocs.concat(children);
      }

      const sidecars = await StorageObject.find({
        parentObjectId: { $in: allDocs.map((p) => p._id) },
        ...orgObjectClause(orgId),
        deletedAt: { $exists: true },
      })
        .select(PURGE_PROJECTION)
        .lean<PurgeDoc[]>();
      docs = [...allDocs, ...sidecars];
    }

    if (docs.length === 0) {
      return NextResponse.json({ success: true, purgedCount: 0 });
    }

    const allDocIds = docs.map((d) => d._id);

    // 1. Remove encrypted blobs from the org's shared B2 bucket (best-effort).
    const storageRegion = await resolveOrgStorageRegion(orgId);
    await deleteB2Objects(
      systemWorkspaceBucketName("ORGANIZATION", storageRegion),
      collectB2Keys(docs),
    );

    // 2. Hard-delete docs + clean up any lingering shares.
    await StorageObject.deleteMany({ _id: { $in: allDocIds } });
    await ShareLink.deleteMany({ objectId: { $in: allDocIds } });
    await DirectShare.deleteMany({ objectId: { $in: allDocIds } });

    // 3. Free the org's storage.
    const totalSize = docs.reduce(
      (sum, d) => sum + (d.size || 0) + versionsTotalBytes(d.versions ?? []),
      0,
    );
    await OrgUsage.updateOne(
      { orgId },
      { $inc: { totalStorageBytes: -totalSize, totalObjects: -docs.length } },
    );

    return NextResponse.json({ success: true, purgedCount: allDocIds.length });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to purge objects";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
