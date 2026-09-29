import { NextRequest, NextResponse } from "next/server";
import { requireAccessContext, objectFilter, bucketOwnershipClause, isAuthzError, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { parseBaseRevision, REVISION_HEADER } from "@/lib/storage/revisions";
import { handleRevisionUpload, revisionError } from "@/lib/storage/revision-upload";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAccessContext(request, "write");
    const baseRevision = parseBaseRevision(request.headers.get(REVISION_HEADER));
    if (baseRevision === null || Number.isNaN(baseRevision)) {
      return NextResponse.json({ error: "Base revision is required", code: "base_revision_required" }, { status: 400 });
    }
    const { id } = await params;
    if (!/^[0-9a-f]{24}$/iu.test(id)) return NextResponse.json({ error: "Invalid file ID" }, { status: 400 });
    await dbConnect();
    const object = await StorageObject.findOne({ ...objectFilter(ctx, id), deletedAt: null });
    if (!object) return NextResponse.json({ error: "File is unavailable" }, { status: 404 });
    const bucket = await Bucket.findOne({ _id: object.bucketId, ...bucketOwnershipClause(ctx) });
    if (!bucket) return NextResponse.json({ error: "Bucket is unavailable" }, { status: 404 });
    return await handleRevisionUpload(request, {
      accountId: ctx.accountId, spaceId: ctx.spaceId, objectId: object._id, bucketId: bucket._id,
      baseRevision, bucketName: bucket.b2BucketId, region: bucket.storageRegion,
    });
  } catch (error) {
    return isAuthzError(error) ? toJsonResponse(error) : revisionError(error);
  }
}
