import { cookies } from "next/headers";
import { connectDatabase, PhotoAsset, ProductSession } from "@xenode/database";
import { resolveSpaceAccess } from "@xenode/spaces";
import { spaceIdSchema } from "@xenode/contracts";
import { decodeTimelineCursor, encodeTimelineCursor } from "@xenode/photos";

export async function GET(request: Request) {
  await connectDatabase();
  const sessionId = (await cookies()).get("xenode_photos_session")?.value;
  const session = sessionId
    ? await ProductSession.findOne({
        sessionId,
        productId: "photos",
        revokedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      }).lean()
    : null;
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const parsedSpaceId = spaceIdSchema.safeParse(url.searchParams.get("spaceId"));
  if (!parsedSpaceId.success) {
    return Response.json({ error: "spaceId is required" }, { status: 400 });
  }
  try {
    await resolveSpaceAccess({
      accountId: session.accountId,
      spaceId: parsedSpaceId.data,
      productId: "photos",
    });
  } catch {
    return Response.json({ error: "Space not found" }, { status: 404 });
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 200);
  const cursorText = url.searchParams.get("cursor");
  const cursor = cursorText ? decodeTimelineCursor(cursorText) : null;
  const query: Record<string, unknown> = {
    spaceId: parsedSpaceId.data,
    status: "active",
  };
  if (cursor) {
    const takenAt = new Date(cursor.takenAt);
    query.$or = [
      { takenAt: { $lt: takenAt } },
      { takenAt, assetId: { $lt: cursor.id } },
    ];
  }
  const rows = await PhotoAsset.find(query)
    .sort({ takenAt: -1, assetId: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return Response.json({
    items,
    nextCursor:
      hasMore && last
        ? encodeTimelineCursor({
            takenAt: last.takenAt.toISOString(),
            id: last.assetId,
          })
        : null,
  });
}
