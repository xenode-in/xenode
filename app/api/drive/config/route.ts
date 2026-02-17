import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import { createB2Bucket } from "@/lib/b2/buckets";

const GLOBAL_BUCKET_NAME = process.env.B2_BUCKET_NAME || "xenode-drive-storage";

export async function GET() {
  try {
    const session = await requireAuth();
    await dbConnect();

    // Check if global bucket exists in DB
    let bucket = await Bucket.findOne({ name: GLOBAL_BUCKET_NAME });

    if (!bucket) {
      console.log(
        `Bucket '${GLOBAL_BUCKET_NAME}' not found in DB, attempting to create/verify in B2...`,
      );

      try {
        // Try to create the bucket
        const b2Location = await createB2Bucket(GLOBAL_BUCKET_NAME);

        // Create DB record
        bucket = await Bucket.create({
          userId: "system",
          name: GLOBAL_BUCKET_NAME,
          b2BucketId: GLOBAL_BUCKET_NAME,
          region: process.env.B2_REGION || "us-west-004",
        });

        console.log(
          `Bucket '${GLOBAL_BUCKET_NAME}' created successfully in B2 and DB`,
        );
      } catch (err: any) {
        // Handle the case where bucket already exists
        if (
          err.Code === "BucketAlreadyOwnedByYou" ||
          err.name === "BucketAlreadyOwnedByYou"
        ) {
          console.log(
            `Bucket '${GLOBAL_BUCKET_NAME}' already exists in B2, creating DB record...`,
          );

          // Bucket exists in B2, just create DB record
          bucket = await Bucket.create({
            userId: "system",
            name: GLOBAL_BUCKET_NAME,
            b2BucketId: GLOBAL_BUCKET_NAME,
            region: process.env.B2_REGION || "us-west-004",
          });

          console.log(
            `DB record created for existing bucket '${GLOBAL_BUCKET_NAME}'`,
          );
        } else if (
          err.Code === "BucketAlreadyExists" ||
          err.name === "BucketAlreadyExists"
        ) {
          // Bucket is owned by someone else - this is a fatal error
          console.error(
            `Bucket '${GLOBAL_BUCKET_NAME}' is owned by another account`,
          );
          return NextResponse.json(
            {
              error: `Storage bucket '${GLOBAL_BUCKET_NAME}' is already taken. Please set a unique B2_BUCKET_NAME in your environment variables.`,
            },
            { status: 500 },
          );
        } else {
          // Unknown error
          console.error("Failed to create global bucket:", err);
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
    console.error("Config route error:", error);

    if (error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
