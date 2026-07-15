import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import { createB2Bucket } from "@/lib/b2/buckets";
import {
  ensureSystemWorkspaceBucketRecord,
} from "@/lib/storage/workspaceBucket";
import { orgObjectKeyPrefix, teamObjectKeyPrefix } from "@/lib/orgs/storage";
import { resolveSystemBucketConfig } from "@xenode/config/storage";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    await dbConnect();
    const storageConfig = resolveSystemBucketConfig();
    const globalBucketName = storageConfig.bucketName;

    if (ctx.spaceType === "organization") {
      const bucket = await ensureSystemWorkspaceBucketRecord("ORGANIZATION");
      return NextResponse.json({
        bucket,
        rootPrefix: orgObjectKeyPrefix(ctx.organizationId!),
      });
    }
    if (ctx.spaceType === "team") {
      const bucket = await ensureSystemWorkspaceBucketRecord("ORGANIZATION");
      return NextResponse.json({
        bucket,
        rootPrefix: teamObjectKeyPrefix(ctx.organizationId!, ctx.teamId!),
      });
    }

    const bucket = await ensureSystemWorkspaceBucketRecord("PERSONAL");

    return NextResponse.json({
      bucket,
      rootPrefix: `users/${ctx.userId}/`,
    });
  } catch (error: any) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    if (error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
