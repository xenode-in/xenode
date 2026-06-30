import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  objectOwnershipClause,
  ownerClause,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import { getOrCreateUsage, recalculateUsage } from "@/lib/metering/usage";
import StorageObject from "@/models/StorageObject";
import { storageCacheKey } from "@/lib/realtime/cache-keys";
import { withRedis } from "@/lib/redis";

function normalizeCategory(category: string | null | undefined): string {
  switch (category) {
    case "image":
      return "Images";
    case "video":
      return "Videos";
    case "audio":
      return "Audio";
    case "document":
    case "pdf":
    case "word":
    case "excel":
    case "powerpoint":
      return "Documents";
    case "archive":
      return "Archives";
    case "code":
      return "Code";
    default:
      return "Other";
  }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    ownerClause(ctx);
    const cacheKey = storageCacheKey(ctx.userId);
    const cached = await withRedis((redis) => redis.get(cacheKey));
    if (cached) {
      return NextResponse.json(JSON.parse(cached), {
        headers: { "x-xenode-cache": "HIT" },
      });
    }

    await dbConnect();

    const [usage, rawBreakdown] = await Promise.all([
      recalculateUsage(ctx.userId).then(
        (value) => value || getOrCreateUsage(ctx.userId),
      ),
      StorageObject.aggregate<{
        _id: string | null;
        bytes: number;
        count: number;
      }>([
        { $match: objectOwnershipClause(ctx) },
        {
          $group: {
            _id: "$mediaCategory",
            bytes: { $sum: "$size" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const grouped = new Map<string, { bytes: number; count: number }>();
    for (const item of rawBreakdown) {
      const label = normalizeCategory(item._id);
      const prev = grouped.get(label) ?? { bytes: 0, count: 0 };
      grouped.set(label, {
        bytes: prev.bytes + item.bytes,
        count: prev.count + item.count,
      });
    }

    const breakdown = Array.from(grouped.entries())
      .map(([category, item]) => ({
        category,
        bytes: item.bytes,
        count: item.count,
      }))
      .sort((a, b) => b.bytes - a.bytes);

    const responseBody = {
      totalStorageBytes: usage.totalStorageBytes ?? 0,
      totalObjects: usage.totalObjects ?? 0,
      totalBuckets: usage.totalBuckets ?? 0,
      storageLimitBytes: usage.storageLimitBytes ?? null,
      plan: usage.plan ?? "free",
      updatedAt: usage.updatedAt?.toISOString?.() ?? null,
      breakdown,
    };
    await withRedis((redis) =>
      redis.set(cacheKey, JSON.stringify(responseBody), "EX", 30),
    );
    return NextResponse.json(responseBody, {
      headers: { "x-xenode-cache": "MISS" },
    });
  } catch (error: unknown) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message = error instanceof Error ? error.message : "Failed to load usage";
    if (message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
