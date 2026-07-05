import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { requireOrgStorageMembership } from "@/lib/orgs/storage";
import { ensureSystemWorkspaceBucketRecord } from "@/lib/storage/workspaceBucket";

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
    const bucket = await ensureSystemWorkspaceBucketRecord("ORGANIZATION");

    return NextResponse.json({ buckets: [bucket] });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to list organization buckets";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
