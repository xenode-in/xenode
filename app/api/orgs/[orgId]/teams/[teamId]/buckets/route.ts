import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import {
  orgStorageOwnerId,
  requireTeamStorageMembership,
  teamBucketClause,
} from "@/lib/orgs/storage";
import { getBucketForWorkspace } from "@/lib/storage/workspaceBucket";
import { emitActivity, ActivityAction } from "@/lib/orgs/activity";
import { createBucketSchema } from "@/lib/validations";
import Bucket from "@/models/Bucket";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string; teamId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId, teamId } = await params;
    await requireTeamStorageMembership({ userId: ctx.userId, orgId, teamId });

    await dbConnect();
    const buckets = await Bucket.find(teamBucketClause(orgId, teamId))
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ buckets });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to list team buckets";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId, teamId } = await params;
    await requireTeamStorageMembership({ userId: ctx.userId, orgId, teamId });

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
    const existing = await Bucket.findOne({
      ...teamBucketClause(orgId, teamId),
      name,
    });
    if (existing) {
      return NextResponse.json(
        { error: "A bucket with this name already exists" },
        { status: 409 },
      );
    }

    const bucket = await Bucket.create({
      userId: orgStorageOwnerId(orgId),
      ownerScope: "team",
      orgId,
      teamId,
      createdBy: ctx.userId,
      name,
      b2BucketId: getBucketForWorkspace("ORGANIZATION"),
    });

    await emitActivity({
      orgId,
      action: ActivityAction.BUCKET_CREATED,
      actorUserId: ctx.userId,
      target: { type: "bucket", id: bucket._id.toString() },
      metadata: { teamId },
    });

    return NextResponse.json({ bucket }, { status: 201 });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to create team bucket";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
