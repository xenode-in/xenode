import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  ownerClause,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { logRequest } from "@/lib/logRequest";

export const dynamic = "force-dynamic";
import { createBucketSchema } from "@/lib/validations";
import dbConnect from "@/lib/mongodb";
import Bucket from "@/models/Bucket";
import { createB2Bucket } from "@/lib/b2/buckets";
import { incrementBucketCount } from "@/lib/metering/usage";
import { captureEvent } from "@/lib/posthog";

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

/** POST /api/buckets - Create a new bucket */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const ctx = await requireAccessContext(request);
    userId = ctx.userId;

    if (!checkRateLimit(userId, 5, 60000)) {
      statusCode = 429;
      errorMessage = "Too many requests. Please wait before creating another bucket.";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const body = await request.json();
    const validation = createBucketSchema.safeParse(body);

    if (!validation.success) {
      statusCode = 400;
      errorMessage = validation.error.issues[0].message;
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const { name } = validation.data;
    const b2BucketName = `xn-${userId.slice(0, 8)}-${name}`;

    await dbConnect();

    const existing = await Bucket.findOne({ ...ownerClause(ctx), name });
    if (existing) {
      statusCode = 409;
      errorMessage = "A bucket with this name already exists";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    let b2BucketId: string;
    try {
      b2BucketId = await createB2Bucket(b2BucketName);
    } catch (err: unknown) {
      statusCode = 502;
      errorMessage = err instanceof Error ? err.message : "Failed to create bucket in storage backend";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const bucket = await Bucket.create({
      userId,
      ownerScope: "personal",
      createdBy: userId,
      name,
      b2BucketId: b2BucketId || b2BucketName,
    });

    await incrementBucketCount(userId);
    captureEvent(userId, "bucket_created", {
      source: "web",
    });

    statusCode = 201;
    return NextResponse.json({ bucket }, { status: statusCode });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      statusCode = error.status;
      errorMessage = error.message;
      return toJsonResponse(error);
    }
    statusCode = 500;
    errorMessage = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  } finally {
    logRequest({
      userId,
      method: request.method,
      endpoint: request.nextUrl.pathname,
      statusCode,
      durationMs: Date.now() - startTime,
      ip: request.headers.get("x-forwarded-for") || "unknown",
      userAgent: request.headers.get("user-agent") || "unknown",
      errorMessage,
    });
  }
}

/** GET /api/buckets - List user's buckets */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const ctx = await requireAccessContext(request);
    userId = ctx.userId;

    await dbConnect();

    const buckets = await Bucket.find(ownerClause(ctx)).sort({ createdAt: -1 }).lean();

    return NextResponse.json({ buckets });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      statusCode = error.status;
      errorMessage = error.message;
      return toJsonResponse(error);
    }
    statusCode = 500;
    errorMessage = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  } finally {
    logRequest({
      userId,
      method: request.method,
      endpoint: request.nextUrl.pathname,
      statusCode,
      durationMs: Date.now() - startTime,
      ip: request.headers.get("x-forwarded-for") || "unknown",
      userAgent: request.headers.get("user-agent") || "unknown",
      errorMessage,
    });
  }
}
