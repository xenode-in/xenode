import { spaceIdSchema } from "@xenode/contracts";
import { PhotoAlbumV2 } from "@xenode/database";
import {
  decodeTimelineCursor,
  encodeTimelineCursor,
  isSealedAlbumName,
  PhotosService,
} from "@xenode/photos";
import { assertSpaceAction, resolveSpaceAccess, SpaceAuthorizationError, type SpaceAction } from "@xenode/spaces";
import { MongoPhotosRepository } from "@/lib/photos-repository";
import { getPhotosProductSession } from "@/lib/session";

async function access(request: Request, action: SpaceAction = "read") {
  const session = await getPhotosProductSession();
  if (!session) return null;
  const parsed = spaceIdSchema.safeParse(
    new URL(request.url).searchParams.get("spaceId"),
  );
  if (!parsed.success) return null;
  const spaceAccess = await resolveSpaceAccess({
    accountId: session.accountId,
    spaceId: parsed.data,
    productId: "photos",
  });
  assertSpaceAction(spaceAccess, action);
  return { session, spaceId: parsed.data };
}

export async function GET(request: Request) {
  let context;
  try {
    context = await access(request);
  } catch {
    return Response.json({ error: "Space not found" }, { status: 404 });
  }
  if (!context) {
    return Response.json({ error: "Unauthorized or invalid Space" }, { status: 401 });
  }
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 60);
  let cursor;
  try {
    cursor = url.searchParams.get("cursor")
      ? decodeTimelineCursor(url.searchParams.get("cursor")!)
      : null;
  } catch {
    return Response.json({ error: "Invalid cursor" }, { status: 400 });
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return Response.json({ error: "Invalid limit" }, { status: 400 });
  }
  // Summaries carry a member count, not the (up to 10,000) member ids.
  const rows: Array<{
    albumId: string;
    encryptedName: string;
    coverPhotoAssetId?: string;
    photoAssetCount: number;
    updatedAt: Date;
  }> = await PhotoAlbumV2.aggregate([
    {
      $match: {
        spaceId: context.spaceId,
        ...(cursor
          ? {
              $or: [
                { updatedAt: { $lt: new Date(cursor.takenAt) } },
                { updatedAt: new Date(cursor.takenAt), albumId: { $lt: cursor.id } },
              ],
            }
          : {}),
      },
    },
    { $sort: { updatedAt: -1, albumId: -1 } },
    { $limit: limit + 1 },
    {
      $project: {
        _id: 0,
        albumId: 1,
        encryptedName: 1,
        updatedAt: 1,
        coverPhotoAssetId: {
          $ifNull: ["$coverPhotoAssetId", { $arrayElemAt: ["$photoAssetIds", 0] }],
        },
        photoAssetCount: { $size: "$photoAssetIds" },
      },
    },
  ]);
  const albums = rows.slice(0, limit);
  const last = albums.at(-1);
  return Response.json(
    {
      albums: albums.map(
        ({ albumId, encryptedName, coverPhotoAssetId, photoAssetCount }) => ({
          albumId,
          encryptedName,
          coverPhotoAssetId,
          photoAssetCount,
        }),
      ),
      nextCursor:
        rows.length > limit && last
          ? encodeTimelineCursor({ takenAt: last.updatedAt.toISOString(), id: last.albumId })
          : null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  let context;
  try {
    context = await access(request, "write");
  } catch (error) {
    if (error instanceof SpaceAuthorizationError && error.status === 403) {
      return Response.json({ error: error.message, code: error.code }, { status: 403 });
    }
    return Response.json({ error: "Space not found" }, { status: 404 });
  }
  if (!context) {
    return Response.json({ error: "Unauthorized or invalid Space" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (
    !body ||
    !isSealedAlbumName(body.encryptedName, context.spaceId, context.session.accountId) ||
    !Array.isArray(body.photoAssetIds) ||
    body.photoAssetIds.length > 10_000 ||
    !body.photoAssetIds.every((id) => typeof id === "string") ||
    (body.coverPhotoAssetId !== undefined &&
      typeof body.coverPhotoAssetId !== "string")
  ) {
    return Response.json({ error: "Invalid album" }, { status: 400 });
  }
  const service = new PhotosService(new MongoPhotosRepository());
  try {
    const album = await service.createAlbum({
      id: crypto.randomUUID(),
      spaceId: context.spaceId,
      encryptedName: body.encryptedName as string,
      photoAssetIds: body.photoAssetIds as string[],
      coverPhotoAssetId:
        typeof body.coverPhotoAssetId === "string"
          ? body.coverPhotoAssetId
          : undefined,
      createdByAccountId: context.session.accountId,
    });
    return Response.json({ album }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Album creation failed" },
      { status: 409 },
    );
  }
}
