import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import {
  ensureSystemWorkspaceBucketRecord,
} from "@/lib/storage/workspaceBucket";
import { orgObjectKeyPrefix, teamObjectKeyPrefix } from "@/lib/orgs/storage";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    await dbConnect();

    if (ctx.spaceType === "organization") {
      const bucket = await ensureSystemWorkspaceBucketRecord(
        "ORGANIZATION",
        ctx.region,
      );
      return NextResponse.json({
        bucket,
        rootPrefix: orgObjectKeyPrefix(ctx.organizationId!),
      });
    }
    if (ctx.spaceType === "team") {
      const bucket = await ensureSystemWorkspaceBucketRecord(
        "ORGANIZATION",
        ctx.region,
      );
      return NextResponse.json({
        bucket,
        rootPrefix: teamObjectKeyPrefix(ctx.organizationId!, ctx.teamId!),
      });
    }

    const bucket = await ensureSystemWorkspaceBucketRecord(
      "PERSONAL",
      ctx.region,
    );

    return NextResponse.json({
      bucket,
      rootPrefix: `users/${ctx.userId}/`,
    });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to load drive config";
    if (message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
