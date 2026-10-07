import { PhotoAsset } from "@xenode/database";
import { decodeTimelineCursor, encodeTimelineCursor } from "@xenode/photos";
import { requirePhotoAccess, photoApiError } from "@/lib/api-access";
export async function GET(request: Request) {
  try {
    const ctx = await requirePhotoAccess(request);
    const url = new URL(request.url),
      limit = Number(url.searchParams.get("limit") ?? 100);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      return Response.json({ error: "Invalid limit" }, { status: 400 });
    let cursor;
    try {
      cursor = url.searchParams.get("cursor")
        ? decodeTimelineCursor(url.searchParams.get("cursor")!)
        : null;
    } catch {
      return Response.json({ error: "Invalid cursor" }, { status: 400 });
    }
    const rows = await PhotoAsset.find({
      spaceId: ctx.spaceId,
      createdByAccountId: ctx.accountId,
      status: "trashed",
      // Deleted forever: erasure is queued and the item can no longer be restored.
      purgeRequestedAt: { $exists: false },
      ...(cursor
        ? {
            $or: [
              { trashedAt: { $lt: new Date(cursor.takenAt) } },
              {
                trashedAt: new Date(cursor.takenAt),
                assetId: { $lt: cursor.id },
              },
            ],
          }
        : {}),
    })
      .sort({ trashedAt: -1, assetId: -1 })
      .limit(limit + 1)
      .lean();
    const items = rows.slice(0, limit),
      last = items.at(-1);
    return Response.json(
      {
        items,
        nextCursor:
          rows.length > limit && last?.trashedAt
            ? encodeTimelineCursor({
                takenAt: last.trashedAt.toISOString(),
                id: last.assetId,
              })
            : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return photoApiError(error);
  }
}
