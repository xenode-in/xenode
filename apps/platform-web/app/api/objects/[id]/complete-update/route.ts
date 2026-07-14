import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  objectFilter,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import StorageObject from "@/models/StorageObject";
import { updateBucketStats } from "@/lib/metering/usage";

export const dynamic = "force-dynamic";

/**
 * POST /api/objects/[id]/complete-update
 * Finalizes the object update by updating the size in database and metering.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAccessContext(request);
    const { id } = await params;
    const { size } = await request.json();

    if (typeof size !== "number" || size < 0) {
      return NextResponse.json({ error: "Valid size is required" }, { status: 400 });
    }

    await dbConnect();

    const object = await StorageObject.findOne(objectFilter(ctx, id));
    if (!object) {
      return NextResponse.json({ error: "Object not found" }, { status: 404 });
    }

    const oldSize = object.size;
    const sizeDiff = size - oldSize;

    // 1. Update database
    object.size = size;
    await object.save();

    // 2. Update metering/usage
    if (sizeDiff !== 0) {
      await updateBucketStats(object.bucketId.toString(), 0, sizeDiff);
      // We don't have a direct "incrementStorage" but usually usage tracks total bytes
      // Looking at usage model, it might need manual adjustment if not handled by middleware
    }

    return NextResponse.json({ success: true, object });
  } catch (error: any) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
