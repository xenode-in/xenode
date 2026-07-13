import { NextRequest, NextResponse } from "next/server";
import {
  requireAccessContext,
  objectFilter,
  bucketOwnershipClause,
  isAuthzError,
  toJsonResponse,
} from "@/lib/authz";
import { assertScopeAction } from "@/lib/authz/policy";
import dbConnect from "@/lib/mongodb";
import StorageObject from "@/models/StorageObject";
import Bucket from "@/models/Bucket";
import { getUploadUrl } from "@/lib/b2/objects";
import { adjustStorageBytes } from "@/lib/metering/usage";
import { adjustOrgStorage } from "@/lib/orgs/billing/orgUsage";
import { resolveWorkspace } from "@/lib/workspace/resolve";
import { parseBaseRevision, REVISION_HEADER } from "@/lib/storage/revisions";
import { applyContentUpdate } from "@/lib/storage/applyContentUpdate";

export const dynamic = "force-dynamic";

/**
 * POST /api/objects/[id]/update-content
 * Overwrites an existing object's content, KEEPING the previous content as a
 * version (newest-first, capped at MAX_VERSIONS_PER_OBJECT).
 *
 * The new content is written to a *fresh* B2 key so the prior bytes are never
 * clobbered — no server-side ciphertext copy is needed, which keeps the E2EE
 * boundary intact. The previous current-content snapshot is prepended to
 * `versions[]`; overflow versions are evicted (B2 blob deleted + quota freed).
 *
 * For direct server uploads, send application/octet-stream with ?iv=<base64>
 * (and optionally ?dek=<base64> if the client rotated the wrapped DEK). JSON
 * requests are the older presigned-url flow and are NOT versioned (deprecated).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAccessContext(request);
    assertScopeAction(ctx, "write");
    const userId = ctx.userId;
    const adjustWorkspaceStorage = (delta: number) =>
      ctx.scope.type === "personal"
        ? adjustStorageBytes(userId, delta)
        : adjustOrgStorage(ctx.scope.orgId, delta);
    const baseRevision = parseBaseRevision(request.headers.get(REVISION_HEADER));
    if (Number.isNaN(baseRevision)) {
      return NextResponse.json(
        { error: "Invalid base revision", code: "invalid_base_revision" },
        { status: 400 },
      );
    }
    const { id } = await params;
    const contentType = request.headers.get("content-type") || "";
    const isJsonRequest = contentType.includes("application/json");
    const body = isJsonRequest ? await request.json() : null;
    const iv = isJsonRequest
      ? body?.iv
      : request.nextUrl.searchParams.get("iv");
    const dek = isJsonRequest
      ? body?.encryptedDEK
      : request.nextUrl.searchParams.get("dek");

    if (!iv) {
      return NextResponse.json({ error: "IV is required" }, { status: 400 });
    }

    await dbConnect();

    const object = await StorageObject.findOne(objectFilter(ctx, id));
    if (!object) {
      return NextResponse.json({ error: "Object not found" }, { status: 404 });
    }
    if (baseRevision !== null && (object.revision ?? 0) !== baseRevision) {
      return NextResponse.json(
        { error: "The object changed since it was opened", code: "revision_conflict", revision: object.revision ?? 0 },
        { status: 409 },
      );
    }

    const bucket = await Bucket.findOne({
      _id: object.bucketId,
      ...bucketOwnershipClause(ctx),
    });
    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    if (!isJsonRequest) {
      const arrayBuffer = await request.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.byteLength === 0) {
        return NextResponse.json(
          { error: "File content is required" },
          { status: 400 },
        );
      }

      const result = await applyContentUpdate({
        object,
        bucket,
        buffer,
        iv,
        encryptedDEK: dek,
        actorUserId: userId,
        baseRevision,
        newKeyPrefix: resolveWorkspace(ctx).keyPrefix,
        adjustWorkspaceStorage,
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: "The object changed since it was opened", code: "revision_conflict", revision: result.revision },
          { status: 409 },
        );
      }

      return NextResponse.json({ success: true, object: result.object, revision: result.revision });
    }

    // Legacy presigned-url flow. Deprecated and NOT versioned — the docs editor
    // now uses the direct binary upload path above.
    object.iv = iv;
    await object.save();

    const uploadUrl = await getUploadUrl(
      bucket.b2BucketId,
      object.key,
      "application/octet-stream",
    );

    return NextResponse.json({ uploadUrl });
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
