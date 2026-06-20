import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import { getOrCreateUsage, recalculateUsage } from "@/lib/metering/usage";
import StorageObject from "@/models/StorageObject";

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
    const session = await requireAuth(request);
    await dbConnect();

    const [usage, rawBreakdown] = await Promise.all([
      recalculateUsage(session.user.id).then(
        (value) => value || getOrCreateUsage(session.user.id),
      ),
      StorageObject.aggregate<{
        _id: string | null;
        bytes: number;
        count: number;
      }>([
        { $match: { userId: session.user.id } },
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

    return NextResponse.json({
      totalStorageBytes: usage.totalStorageBytes ?? 0,
      totalObjects: usage.totalObjects ?? 0,
      totalBuckets: usage.totalBuckets ?? 0,
      storageLimitBytes: usage.storageLimitBytes ?? null,
      plan: usage.plan ?? "free",
      updatedAt: usage.updatedAt?.toISOString?.() ?? null,
      breakdown,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load usage";
    if (message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
