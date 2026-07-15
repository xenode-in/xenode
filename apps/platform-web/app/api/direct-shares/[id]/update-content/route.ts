import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import DirectShare from "@/models/DirectShare";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { Space, type SpaceRecord } from "@xenode/database/models";
import { canEdit, normalizeShareRole } from "@/lib/orgs/shareRoles";
import { adjustStorageBytes } from "@/lib/metering/usage";
import { adjustOrgStorage } from "@/lib/orgs/billing/orgUsage";
import { orgObjectKeyPrefix } from "@/lib/orgs/storage";
import { parseBaseRevision, REVISION_HEADER } from "@/lib/storage/revisions";
import { applyContentUpdate } from "@/lib/storage/applyContentUpdate";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/direct-shares/[id]/update-content?iv=<base64>
 * Share-authorized counterpart of /api/objects/[id]/update-content: lets a
 * recipient with the `editor` role save new ciphertext for the shared object.
 * Quota and the new B2 key are attributed to the file OWNER's workspace; the
 * version snapshot is attributed to the recipient. The base revision header is
 * mandatory so a recipient can never blind-overwrite the owner's newer save.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { id } = await params;

    const baseRevision = parseBaseRevision(request.headers.get(REVISION_HEADER));
    if (baseRevision === null || Number.isNaN(baseRevision)) {
      return NextResponse.json(
        { error: "Base revision is required", code: "base_revision_required" },
        { status: 400 },
      );
    }

    const iv = request.nextUrl.searchParams.get("iv");
    if (!iv) {
      return NextResponse.json({ error: "IV is required" }, { status: 400 });
    }

    await dbConnect();

    const share = await DirectShare.findOne({ _id: id, isRevoked: false });
    if (!share) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    const recipient = share.recipients.find(
      (item) => item.recipientUserId === ctx.userId,
    );
    if (!recipient) {
      return NextResponse.json(
        { error: "You do not have access to this share" },
        { status: 403 },
      );
    }

    if (!canEdit(normalizeShareRole(recipient.accessType))) {
      return NextResponse.json(
        { error: "You need edit access to save changes", code: "edit_forbidden" },
        { status: 403 },
      );
    }

    const object = await StorageObject.findOne({
      _id: share.objectId,
      deletedAt: { $exists: false },
    });
    if (!object) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if ((object.revision ?? 0) !== baseRevision) {
      return NextResponse.json(
        { error: "The object changed since it was opened", code: "revision_conflict", revision: object.revision ?? 0 },
        { status: 409 },
      );
    }

    if (object.chunks && object.chunks.length > 0) {
      return NextResponse.json(
        { error: "Chunked objects cannot be updated through a share", code: "chunked_object_unsupported" },
        { status: 400 },
      );
    }

    const bucket = await Bucket.findById(object.bucketId)
      .select("b2BucketId")
      .lean();
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    const buffer = Buffer.from(await request.arrayBuffer());
    if (buffer.byteLength === 0) {
      return NextResponse.json(
        { error: "File content is required" },
        { status: 400 },
      );
    }

    // Attribute storage to the canonical Space owner, never the recipient.
    const space = await Space.findById(object.spaceId).lean<SpaceRecord>();
    if (!space || space.status !== "active") {
      return NextResponse.json(
        { error: "Owning Space is unavailable", code: "space_unavailable" },
        { status: 409 },
      );
    }
    const organizationId =
      space.type === "organization" || space.type === "team"
        ? space.organizationId
        : undefined;
    const ownerAccountId =
      space.type === "personal" ? space.ownerAccountId : undefined;
    if (!organizationId && !ownerAccountId) {
      return NextResponse.json(
        { error: "Owning Space is invalid", code: "space_invalid" },
        { status: 409 },
      );
    }
    const newKeyPrefix = organizationId
      ? orgObjectKeyPrefix(organizationId)
      : `users/${ownerAccountId}/`;
    const adjustWorkspaceStorage = (delta: number) =>
      organizationId
        ? adjustOrgStorage(organizationId, delta)
        : adjustStorageBytes(ownerAccountId!, delta);

    const result = await applyContentUpdate({
      object,
      bucket,
      buffer,
      iv,
      actorUserId: ctx.userId,
      baseRevision,
      newKeyPrefix,
      adjustWorkspaceStorage,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: "The object changed since it was opened", code: "revision_conflict", revision: result.revision },
        { status: 409 },
      );
    }

    await DirectShare.updateOne(
      { _id: share._id, "recipients.recipientUserId": ctx.userId },
      { $set: { "recipients.$.lastAccessedAt": new Date() } },
    );

    return NextResponse.json({ success: true, revision: result.revision });
  } catch (error: unknown) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    if (message === "QUOTA_EXCEEDED") {
      return NextResponse.json(
        { error: "storage_quota_exceeded" },
        { status: 402 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
