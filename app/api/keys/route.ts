import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { logRequest } from "@/lib/logRequest";

export const dynamic = "force-dynamic";
import dbConnect from "@/lib/mongodb";
import ApiKey, { generateApiKey } from "@/models/ApiKey";
import { createApiKeySchema } from "@/lib/validations";

/**
 * POST /api/keys - Create a new API key
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const session = await requireAuth();
    userId = session.user.id;

    const body = await request.json();
    const validation = createApiKeySchema.safeParse(body);

    if (!validation.success) {
      statusCode = 400;
      errorMessage = validation.error.issues[0].message;
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const { name, expiresIn } = validation.data;

    await dbConnect();

    // Limit to 10 active keys per user
    const keyCount = await ApiKey.countDocuments({ userId });
    if (keyCount >= 10) {
      statusCode = 400;
      errorMessage = "Maximum of 10 API keys allowed";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }

    const { fullKey, keyPrefix, keyHash } = generateApiKey();

    let expiresAt: Date | null = null;
    if (expiresIn !== "never") {
      const now = new Date();
      switch (expiresIn) {
        case "30d":
          expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
          break;
        case "90d":
          expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
          break;
        case "1y":
          expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
          break;
      }
    }

    const apiKey = await ApiKey.create({
      userId,
      name,
      keyPrefix,
      keyHash,
      expiresAt,
    });

    // Return the full key only on creation
    statusCode = 201;
    return NextResponse.json(
      {
        key: {
          id: apiKey._id,
          name: apiKey.name,
          keyPrefix: apiKey.keyPrefix,
          fullKey, // Only shown once!
          expiresAt: apiKey.expiresAt,
          createdAt: apiKey.createdAt,
        },
      },
      { status: statusCode },
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      statusCode = 401;
      errorMessage = "Unauthorized";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    statusCode = 500;
    errorMessage =
      error instanceof Error ? error.message : "Internal server error";
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

/**
 * GET /api/keys - List user's API keys (without the actual key)
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  let userId: string | null = null;
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const session = await requireAuth();
    userId = session.user.id;

    await dbConnect();

    const keys = await ApiKey.find({ userId })
      .select("-keyHash")
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ keys });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      statusCode = 401;
      errorMessage = "Unauthorized";
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
    statusCode = 500;
    errorMessage =
      error instanceof Error ? error.message : "Internal server error";
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
