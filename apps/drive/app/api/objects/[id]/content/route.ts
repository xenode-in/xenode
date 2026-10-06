import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  isAuthzError,
  objectFilter,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";
import { getDownloadUrl } from "@/lib/b2/objects";
import { fileUrlLifetime } from "@/lib/b2/cdn";
import { enforceStorageAccess } from "@/lib/subscriptions/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const userId = ctx.userId;
    await enforceStorageAccess(userId);
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const isPreview = searchParams.get("preview") === "true";
    const versionId = searchParams.get("version");

    await dbConnect();

    const object = await StorageObject.findOne(objectFilter(ctx, id));
    if (!object) {
      return NextResponse.json({ error: "Object not found" }, { status: 404 });
    }

    if (!object.isEncrypted) {
      return NextResponse.json(
        { error: "Not an encrypted object" },
        { status: 400 },
      );
    }

    const bucket = await Bucket.findOne({
      _id: object.bucketId,
      ...bucketOwnershipClause(ctx),
    });
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    // Serve a specific historical version when `?version=` is supplied.
    let chunksToServe = object.chunks;
    let keyToServe = isPreview && object.optimizedKey ? object.optimizedKey : object.key;
    if (versionId) {
      const version = (object.versions || []).find((v) => v.versionId === versionId);
      if (!version) {
        return NextResponse.json({ error: "Version not found" }, { status: 404 });
      }
      if (version.pendingDeletion) {
        return NextResponse.json({ error: "Version deletion is pending" }, { status: 409 });
      }
      keyToServe = version.key;
      chunksToServe = version.chunks;
    }

    const lifetime = fileUrlLifetime(ctx.session?.session.expiresAt);
    const chunked = (!isPreview || !!versionId) && chunksToServe?.length;
    const chunkUrls = chunked ? await Promise.all([...chunksToServe!].sort((a, b) => a.index - b.index).map(part => getDownloadUrl(bucket.b2BucketId, part.key, lifetime))) : undefined;
    const url = chunkUrls ? undefined : await getDownloadUrl(bucket.b2BucketId, keyToServe, lifetime);
    return NextResponse.json({ objectId: String(object._id), versionId, url, chunkUrls }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.name === "SubscriptionRequired") {
      return NextResponse.json(
        { error: "Active subscription required" },
        { status: 402 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message ? message : "Internal server error" }, { status: 500 });
  }
}
