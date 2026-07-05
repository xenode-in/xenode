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

const GLOBAL_BUCKET_NAME = process.env.S3_BUCKET_NAME || "xenode-drive-storage";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    await dbConnect();

    if (ctx.scope.type === "organization") {
      const bucket = await ensureSystemWorkspaceBucketRecord("ORGANIZATION");
      return NextResponse.json({
        bucket,
        rootPrefix: orgObjectKeyPrefix(ctx.scope.orgId),
      });
    }
    if (ctx.scope.type === "team") {
      const bucket = await ensureSystemWorkspaceBucketRecord("ORGANIZATION");
      return NextResponse.json({
        bucket,
        rootPrefix: teamObjectKeyPrefix(ctx.scope.orgId, ctx.scope.teamId),
      });
    }

    bucketOwnershipClause(ctx);
    let bucket = await Bucket.findOne({ name: GLOBAL_BUCKET_NAME });

    if (!bucket) {
      try {
        await createB2Bucket(GLOBAL_BUCKET_NAME);
        bucket = await Bucket.create({
          userId: "system",
          name: GLOBAL_BUCKET_NAME,
          b2BucketId: GLOBAL_BUCKET_NAME,
          region: process.env.S3_REGION || "us-west-004",
        });
      } catch (err: any) {
        if (
          err.Code === "BucketAlreadyOwnedByYou" ||
          err.name === "BucketAlreadyOwnedByYou"
        ) {
          bucket = await Bucket.create({
            userId: "system",
            name: GLOBAL_BUCKET_NAME,
            b2BucketId: GLOBAL_BUCKET_NAME,
            region: process.env.S3_REGION || "us-west-004",
          });
        } else if (
          err.Code === "BucketAlreadyExists" ||
          err.name === "BucketAlreadyExists"
        ) {
          return NextResponse.json(
            {
              error: `Storage bucket '${GLOBAL_BUCKET_NAME}' is already taken. Please set a unique S3_BUCKET_NAME.`,
            },
            { status: 500 },
          );
        } else {
          return NextResponse.json(
            { error: "Failed to initialize storage: " + err.message },
            { status: 500 },
          );
        }
      }
    }

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
