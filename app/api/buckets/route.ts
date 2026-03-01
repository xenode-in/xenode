import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
import { createBucketSchema } from "@/lib/validations";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import { createB2Bucket } from "@/lib/b2/buckets";
import { incrementBucketCount } from "@/lib/metering/usage";
import { captureEvent } from "@/lib/posthog";

// Rate limiting - simple in-memory store
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(
  userId: string,
  limit: number = 10,
  windowMs: number = 60000,
): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(userId);

  if (!record || now > record.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (record.count >= limit) {
    return false;
  }

  record.count++;
  return true;
}

/**
 * POST /api/buckets - Create a new bucket
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    if (!checkRateLimit(userId, 5, 60000)) {
      return NextResponse.json(
        {
          error:
            "Too many requests. Please wait before creating another bucket.",
        },
        { status: 429 },
      );
    }

    const body = await request.json();
    const validation = createBucketSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0].message },
        { status: 400 },
      );
    }

    const { name } = validation.data;

    const b2BucketName = `xn-${userId.slice(0, 8)}-${name}`;

    await dbConnect();

    const existing = await Bucket.findOne({ userId, name });
    if (existing) {
      return NextResponse.json(
        { error: "A bucket with this name already exists" },
        { status: 409 },
      );
    }

    let b2BucketId: string;
    try {
      b2BucketId = await createB2Bucket(b2BucketName);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to create bucket in storage backend";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const bucket = await Bucket.create({
      userId,
      name,
      b2BucketId: b2BucketId || b2BucketName,
    });

    await incrementBucketCount(userId);

    // Fire analytics event (non-blocking)
    captureEvent(userId, "bucket_created", { bucketName: name });

    return NextResponse.json({ bucket }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/buckets - List user's buckets
 */
export async function GET() {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    await dbConnect();

    const buckets = await Bucket.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ buckets });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
