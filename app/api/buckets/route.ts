import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
import { createBucketSchema } from "@/lib/validations";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import { createB2Bucket } from "@/lib/b2/buckets";
import { incrementBucketCount } from "@/lib/metering/usage";
import { captureEvent } from "@/lib/posthog";
import { logRequest } from "@/lib/logRequest";

// Rate limiting - simple in-memory store
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(
  userId: string,
  limit = 10,
  windowMs = 60000
): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(userId);
  if (!record || now > record.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (record.count >= limit) return false;
  record.count++;
  return true;
}

/** POST /api/buckets - Create a new bucket */
export async function POST(request: NextRequest) {
  const start = Date.now();
  let userId = "";
  try {
    const session = await requireAuth();
    userId = session.user.id;

    if (!checkRateLimit(userId, 5, 60000)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before creating another bucket." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const validation = createBucketSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const { name } = validation.data;
    const b2BucketName = `xn-${userId.slice(0, 8)}-${name}`;

    await dbConnect();

    const existing = await Bucket.findOne({ userId, name });
    if (existing) {
      return NextResponse.json(
        { error: "A bucket with this name already exists" },
        { status: 409 }
      );
    }

    let b2BucketId: string;
    try {
      b2BucketId = await createB2Bucket(b2BucketName);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create bucket in storage backend";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const bucket = await Bucket.create({
      userId,
      name,
      b2BucketId: b2BucketId || b2BucketName,
    });

    await incrementBucketCount(userId);

    captureEvent(userId, "bucket_created", { bucketName: name });

    logRequest({
      userId,
      method: "POST",
      endpoint: "/api/buckets",
      statusCode: 201,
      durationMs: Date.now() - start,
      ip: request.headers.get("x-forwarded-for") ?? "unknown",
      userAgent: request.headers.get("user-agent") ?? "unknown",
      metadata: { bucketName: name },
    });

    return NextResponse.json({ bucket }, { status: 201 });
  } catch (error: unknown) {
    const isUnauth = error instanceof Error && error.message === "Unauthorized";
    const statusCode = isUnauth ? 401 : 500;
    const message = isUnauth
      ? "Unauthorized"
      : error instanceof Error
      ? error.message
      : "Internal server error";

    logRequest({
      userId: userId || null,
      method: "POST",
      endpoint: "/api/buckets",
      statusCode,
      durationMs: Date.now() - start,
      ip: request.headers.get("x-forwarded-for") ?? "unknown",
      userAgent: request.headers.get("user-agent") ?? "unknown",
      errorMessage: message,
    });

    return NextResponse.json({ error: message }, { status: statusCode });
  }
}

/** GET /api/buckets - List user's buckets */
export async function GET(request: NextRequest) {
  const start = Date.now();
  let userId = "";
  try {
    const session = await requireAuth();
    userId = session.user.id;

    await dbConnect();
    const buckets = await Bucket.find({ userId }).sort({ createdAt: -1 }).lean();

    logRequest({
      userId,
      method: "GET",
      endpoint: "/api/buckets",
      statusCode: 200,
      durationMs: Date.now() - start,
      ip: request.headers.get("x-forwarded-for") ?? "unknown",
      userAgent: request.headers.get("user-agent") ?? "unknown",
      metadata: { count: buckets.length },
    });

    return NextResponse.json({ buckets });
  } catch (error: unknown) {
    const isUnauth = error instanceof Error && error.message === "Unauthorized";
    const statusCode = isUnauth ? 401 : 500;
    const message = isUnauth ? "Unauthorized" : "Internal server error";

    logRequest({
      userId: userId || null,
      method: "GET",
      endpoint: "/api/buckets",
      statusCode,
      durationMs: Date.now() - start,
      ip: request.headers.get("x-forwarded-for") ?? "unknown",
      userAgent: request.headers.get("user-agent") ?? "unknown",
      errorMessage: message,
    });

    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
