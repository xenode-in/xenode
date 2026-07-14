import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  objectOwnershipClause,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import StorageObject from "@/models/StorageObject";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAccessContext(req);
    const { searchParams } = new URL(req.url);
    const lastSyncParam = searchParams.get("lastSync");
    const lastSyncDate = lastSyncParam ? new Date(lastSyncParam) : new Date(0);

    await dbConnect();

    // Query for user's files updated after lastSync (exclude sidecar files)
    const files = await StorageObject.find({
      ...objectOwnershipClause(ctx),
      updatedAt: { $gt: lastSyncDate },
      isSidecar: { $ne: true },
    })
      .select("_id key size contentType encryptedContentType mediaCategory createdAt updatedAt " +
              "isEncrypted encryptedName tags thumbnail bucketId encryptedDisplayName deletedAt uploadSource syncContentFp")
      .sort({ updatedAt: 1 }) // Return oldest first so deltas apply correctly
      .limit(1000) // Chunk results so we don't blow up memory on first sync
      .lean();

    return NextResponse.json({ files });
  } catch (error: any) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    console.error("[Sync API]", error);
    return NextResponse.json({ error: "Unauthorized or Error" }, { status: 500 });
  }
}
