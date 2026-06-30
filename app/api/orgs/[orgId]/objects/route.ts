import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { getSignedFileUrl } from "@/lib/b2/cdn";
import dbConnect from "@/lib/mongodb";
import {
  loadOrgBucket,
  orgObjectClause,
  requireOrgStorageMembership,
} from "@/lib/orgs/storage";
import StorageObject from "@/models/StorageObject";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

const LIST_PROJECTION =
  "key size contentType encryptedContentType thumbnail tags position starred lastAccessedAt uploadSource createdAt " +
  "isEncrypted encryptedName encryptedDisplayName mediaCategory optimizedKey optimizedEncryptedDEK optimizedIV optimizedSize aspectRatio " +
  "wrappedBy spaceKeyVersion spaceKeyWrapIv createdBy";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await requireOrgStorageMembership({ userId: ctx.userId, orgId, action: "read" });

    const { searchParams } = request.nextUrl;
    const bucketId = searchParams.get("bucketId");
    if (!bucketId) {
      return NextResponse.json({ error: "Bucket ID is required" }, { status: 400 });
    }

    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_PAGE_SIZE), 10)),
    );
    const prefix = searchParams.get("prefix");
    const deleted = searchParams.get("deleted") === "true";
    const fetchAll = searchParams.get("fetchAll") === "true";
    const mediaCategoryFilter = searchParams.get("mediaCategory");
    const contentTypeFilter = searchParams.get("contentType");

    await dbConnect();
    const bucket = await loadOrgBucket({ orgId, bucketId, action: "read" });

    const query: Record<string, unknown> = {
      bucketId,
      ...orgObjectClause(orgId),
      deletedAt: { $exists: deleted },
      isSidecar: { $ne: true },
    };

    if (prefix !== null) {
      query.key = { $regex: `^${escapeRegex(prefix)}[^/]+/?$` };
    }

    if (mediaCategoryFilter) {
      query.mediaCategory = mediaCategoryFilter;
    } else if (contentTypeFilter) {
      query.contentType = { $regex: `^${contentTypeFilter}/`, $options: "i" };
    }

    const dbQuery = StorageObject.find(query)
      .select(deleted ? `${LIST_PROJECTION} deletedAt` : LIST_PROJECTION)
      .sort({ createdAt: -1, _id: -1 });
    const rawObjects = fetchAll
      ? await dbQuery.lean()
      : await dbQuery.limit(limit + 1).lean();
    const hasNextPage = fetchAll ? false : rawObjects.length > limit;
    const objects = (hasNextPage ? rawObjects.slice(0, limit) : rawObjects).map(
      (object) => {
        const out: typeof object & {
          thumbnailUrl?: string;
          optimizedUrl?: string;
        } = object;
        if (object.thumbnail) {
          out.thumbnailUrl = getSignedFileUrl(bucket.b2BucketId, object.thumbnail);
        }
        if (object.optimizedKey) {
          out.optimizedUrl = getSignedFileUrl(bucket.b2BucketId, object.optimizedKey);
        }
        return out;
      },
    );

    return NextResponse.json({
      objects,
      pagination: {
        limit: fetchAll ? rawObjects.length : limit,
        hasNextPage,
        nextCursor: null,
      },
    });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to list organization objects";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
