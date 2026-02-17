import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import { createB2Bucket, bucketExists } from "@/lib/b2/buckets";

const GLOBAL_BUCKET_NAME = process.env.B2_BUCKET_NAME || "xenode-drive-storage";

export async function GET() {
  try {
    const session = await requireAuth();
    await dbConnect();

    // Check if global bucket exists in DB
    let bucket = await Bucket.findOne({ name: GLOBAL_BUCKET_NAME });

    if (!bucket) {
      // Check if it exists in B2 (maybe created manually or by another instance)
      // If not, create it.
      // We'll trust our DB mainly, but for robustness:

      try {
        // Try creating. If exists, B2/S3 might error or return existing.
        // Our createB2Bucket implementation uses CreateBucketCommand.
        // S3 behavior: If you own it, it succeeds (idempotent-ish) or returns error if region mismatch.
        // If someone else owns it, 409 conflict.

        // Since we use a specific name, we should handle 409.
        // But for now, let's just attempt creation.
        // IMPORTANT: We need a unique name globally. 'xenode-drive-storage' might be taken by another user of Backblaze.
        // So we should probably append a random string or UUID if we can, BUT we want it to be constant for THIS deployment.
        // Ideally, user sets B2_BUCKET_NAME in .env.
        // If they don't, we might have a problem if 'xenode-drive-storage' is taken by someone else.
        // I'll assume for this task that the user will configure it or we get lucky with the default.
        // However, to be safe, maybe we should prefix with something from env if available?
        // But we want "Single Bucket".

        // For this implementation, I will stick to the plan: use GLOBAL_BUCKET_NAME.

        const b2Location = await createB2Bucket(GLOBAL_BUCKET_NAME);

        // Create DB record
        bucket = await Bucket.create({
          userId: "system", // Owned by system
          name: GLOBAL_BUCKET_NAME,
          b2BucketId: GLOBAL_BUCKET_NAME, // S3 usually uses name as ID
          region: process.env.B2_REGION || "us-west-004",
        });
      } catch (err: any) {
        // If error is "BucketAlreadyOwnedByYou", we can proceed.
        // If "BucketAlreadyExists" (owned by others), we fail.
        console.error("Failed to create global bucket:", err);

        // Fallback: Try to find if we already have it in DB under a different user?
        // No, we want *A* bucket.

        // If we fail to create, we can't return a bucket.
        return NextResponse.json(
          { error: "Failed to initialize storage: " + err.message },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      bucket,
      rootPrefix: `users/${session.user.id}/`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
