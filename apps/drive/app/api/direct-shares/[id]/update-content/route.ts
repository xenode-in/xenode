import { NextRequest, NextResponse } from "next/server";
import { requireAccessContext, isAuthzError, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import DirectShare from "@/models/DirectShare";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { canEdit, normalizeShareRole } from "@/lib/orgs/shareRoles";
import { parseBaseRevision, REVISION_HEADER } from "@/lib/storage/revisions";
import { handleRevisionUpload, revisionError } from "@/lib/storage/revision-upload";
import { Space } from "@xenode/database/models";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAccessContext(request);
    const baseRevision = parseBaseRevision(request.headers.get(REVISION_HEADER));
    if (baseRevision === null || Number.isNaN(baseRevision)) {
      return NextResponse.json({ error: "Base revision is required", code: "base_revision_required" }, { status: 400 });
    }
    const { id } = await params;
    if (!/^[0-9a-f]{24}$/iu.test(id)) return NextResponse.json({ error: "Invalid share ID" }, { status: 400 });
    await dbConnect();
    const share = await DirectShare.findOne({ _id: id, isRevoked: false });
    if (!share) return NextResponse.json({ error: "Share is unavailable" }, { status: 404 });
    const recipient = share.recipients.find((item) => item.recipientUserId === ctx.accountId);
    if (!recipient || !canEdit(normalizeShareRole(recipient.accessType))) {
      return NextResponse.json({ error: "The share does not permit editing", code: "edit_forbidden" }, { status: 403 });
    }
    const object = await StorageObject.findOne({ _id: share.objectId, bucketId: share.bucketId, deletedAt: null, purgeState: { $exists: false } });
    if (!object || !await Space.exists({ _id: object.spaceId, status: "active" })) return NextResponse.json({ error: "File is unavailable" }, { status: 404 });
    const bucket = await Bucket.findById(object.bucketId);
    if (!bucket) return NextResponse.json({ error: "Bucket is unavailable" }, { status: 404 });
    return await handleRevisionUpload(request, {
      accountId: ctx.accountId, spaceId: object.spaceId, objectId: object._id, bucketId: bucket._id,
      shareId: share._id, baseRevision, bucketName: bucket.b2BucketId, region: bucket.storageRegion,
    });
  } catch (error) {
    return isAuthzError(error) ? toJsonResponse(error) : revisionError(error);
  }
}
