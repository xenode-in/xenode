import { reorderDriveObjects, DriveSyncError } from "@xenode/database";
import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request, "write");
    const body = await request.json();
    const { bucketId, items } = body;

    if (!bucketId || !items || !Array.isArray(items)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    await dbConnect();

    const bucket = await Bucket.findOne({
      _id: bucketId,
      ...bucketOwnershipClause(ctx),
    });

    if (!bucket) {
      return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
    }

    await reorderDriveObjects({ spaceId: ctx.spaceId, bucketId: bucket._id, items });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof DriveSyncError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    return NextResponse.json({ error: "Failed to reorder items" }, { status: 500 });
  }
}
