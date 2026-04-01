import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import { createB2Bucket } from "@/lib/b2/buckets";

const GLOBAL_BUCKET_NAME = process.env.S3_BUCKET_NAME || "xenode-drive-storage";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    await dbConnect();

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
      rootPrefix: `users/${session.user.id}/`,
    });
  } catch (error: any) {
    if (error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
