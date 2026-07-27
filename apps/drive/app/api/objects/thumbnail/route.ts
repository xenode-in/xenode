import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  getAccessContext,
  isAuthzError,
  toJsonResponse,
} from "@/lib/authz";
import { getDownloadUrl } from "@/lib/b2/objects";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import { orgObjectKeyPrefix, teamObjectKeyPrefix } from "@/lib/orgs/storage";
import { resolveShareKeyBucket } from "@/lib/storage/shareBucket";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const key = request.nextUrl.searchParams.get("key");

    if (!key) {
      return NextResponse.json({ error: "Missing key" }, { status: 400 });
    }

    let ctx = null;
    try {
      ctx = await getAccessContext(request);
    } catch (error) {
      if (!key.startsWith("shares/") && isAuthzError(error)) {
        return toJsonResponse(error);
      }
    }

    const userId = ctx?.userId ?? null;

    const workspacePrefix =
      ctx?.spaceType === "organization"
        ? orgObjectKeyPrefix(ctx.organizationId!)
        : ctx?.spaceType === "team"
          ? teamObjectKeyPrefix(ctx.organizationId!, ctx.teamId!)
          : null;

    if (key.startsWith("shares/")) {
      // Public share thumbnails are intentionally readable without auth.
    } else if (userId && key.startsWith(`users/${userId}/`)) {
      // The ownership query below also fails closed for non-personal scopes.
    } else if (workspacePrefix && key.startsWith(workspacePrefix)) {
      // Org/team thumbnails — access is already gated by the resolved scope
      // (getAccessContext verified org/team membership).
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await dbConnect();

    const bucket = key.startsWith("shares/")
      ? await resolveShareKeyBucket(key)
      : await Bucket.findOne(ctx ? bucketOwnershipClause(ctx) : { _id: null });

    if (!bucket) {
      return NextResponse.json(
        { error: "Storage bucket not found" },
        { status: 404 },
      );
    }

    const url = await getDownloadUrl(bucket.b2BucketId, key, 3600);
    return NextResponse.json({ url });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
