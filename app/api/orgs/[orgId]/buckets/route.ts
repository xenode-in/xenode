import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import {
  orgBucketClause,
  orgStorageOwnerId,
  requireOrgStorageMembership,
} from "@/lib/orgs/storage";
import { getBucketForWorkspace } from "@/lib/storage/workspaceBucket";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import { createBucketSchema } from "@/lib/validations";
import Bucket from "@/models/Bucket";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await requireOrgStorageMembership({ userId: ctx.userId, orgId, action: "read" });

    await dbConnect();
    const buckets = await Bucket.find(orgBucketClause(orgId))
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ buckets });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to list organization buckets";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;
    await requireOrgStorageMembership({ userId: ctx.userId, orgId, action: "manage" });

    const body = await request.json().catch(() => ({}));
    const validation = createBucketSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0].message },
        { status: 400 },
      );
    }

    const { name } = validation.data;
    await dbConnect();
    const existing = await Bucket.findOne({ ...orgBucketClause(orgId), name });
    if (existing) {
      return NextResponse.json(
        { error: "A bucket with this name already exists" },
        { status: 409 },
      );
    }

    // Logical space inside the shared organization bucket — no B2 provisioning.
    // Isolation comes from the `workspaces/{orgId}/...` object-key prefix.
    const bucket = await Bucket.create({
      userId: orgStorageOwnerId(orgId),
      ownerScope: "organization",
      orgId,
      createdBy: ctx.userId,
      name,
      b2BucketId: getBucketForWorkspace("ORGANIZATION"),
    });

    await emitActivity({
      orgId,
      action: ActivityAction.BUCKET_CREATED,
      actorUserId: ctx.userId,
      target: { type: "bucket", id: bucket._id.toString() },
    });

    return NextResponse.json({ bucket }, { status: 201 });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to create organization bucket";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
