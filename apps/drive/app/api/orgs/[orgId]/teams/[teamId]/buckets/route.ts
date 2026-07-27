import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { requireTeamStorageMembership } from "@/lib/orgs/storage";
import { ensureSystemWorkspaceBucketRecord } from "@/lib/storage/workspaceBucket";
import { resolveOrgStorageRegion } from "@/lib/storage/region";

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
    const region = await resolveOrgStorageRegion(orgId);
    const bucket = await ensureSystemWorkspaceBucketRecord(
      "ORGANIZATION",
      region,
    );

    return NextResponse.json({ buckets: [bucket] });
  } catch (error) {
    if (isAuthzError(error)) return toJsonResponse(error);
    const message =
      error instanceof Error ? error.message : "Failed to list team buckets";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
