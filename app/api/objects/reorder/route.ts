import { NextRequest, NextResponse } from "next/server";
import {
  bucketOwnershipClause,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
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

    const operations = items.map((item: { id: string; position: number }) => ({
      updateOne: {
        filter: { _id: item.id, bucketId: bucket._id },
        update: { $set: { position: item.position } },
      },
    }));

    if (operations.length > 0) {
      await StorageObject.bulkWrite(operations);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    return NextResponse.json({ error: "Failed to reorder items" }, { status: 500 });
  }
}
