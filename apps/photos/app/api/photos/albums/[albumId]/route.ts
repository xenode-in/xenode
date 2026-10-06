import { PhotoAlbumV2, PhotoAsset } from "@xenode/database";
import { requirePhotoAccess, photoApiError } from "@/lib/api-access";

/** One page of an album's active photos, in album order (cursor = offset). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ albumId: string }> },
) {
  try {
    const ctx = await requirePhotoAccess(request);
    const { albumId } = await params;
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const offset = Number(url.searchParams.get("cursor") ?? 0);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    ) {
      return Response.json({ error: "Invalid page" }, { status: 400 });
    }
    const [album]: Array<{ page: string[]; total: number }> =
      await PhotoAlbumV2.aggregate([
        { $match: { albumId, spaceId: ctx.spaceId } },
        {
          $project: {
            _id: 0,
            page: { $slice: ["$photoAssetIds", offset, limit] },
            total: { $size: "$photoAssetIds" },
          },
        },
      ]);
    if (!album) {
      return Response.json({ error: "Album not found" }, { status: 404 });
    }
    const assets = await PhotoAsset.find({
      spaceId: ctx.spaceId,
      assetId: { $in: album.page },
      status: "active",
    }).lean();
    const byId = new Map(assets.map((asset) => [asset.assetId, asset]));
    return Response.json(
      {
        items: album.page.flatMap((id) => byId.get(id) ?? []),
        nextCursor:
          offset + limit < album.total ? String(offset + limit) : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return photoApiError(error);
  }
}
