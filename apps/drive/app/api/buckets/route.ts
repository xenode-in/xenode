import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import { logRequest } from "@/lib/logRequest";
import { ensureSystemWorkspaceBucketRecord } from "@/lib/storage/workspaceBucket";

export const dynamic = "force-dynamic";

/** POST /api/buckets - physical buckets are system-managed */
export async function POST(request: NextRequest) {
  await requireAccessContext(request);
  return NextResponse.json(
    {
      error: "Custom buckets are no longer supported",
      code: "system_bucket_only",
    },
    { status: 410 },
  );
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

    const bucket = await ensureSystemWorkspaceBucketRecord(
      "PERSONAL",
      ctx.region,
    );

    return NextResponse.json({ buckets: [bucket] });
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
