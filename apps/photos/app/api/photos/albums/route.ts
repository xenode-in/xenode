import { spaceIdSchema } from "@xenode/contracts";
import { PhotoAlbumV2 } from "@xenode/database";
import { PhotosService } from "@xenode/photos";
import { resolveSpaceAccess } from "@xenode/spaces";
import { MongoPhotosRepository } from "@/lib/photos-repository";
import { getPhotosProductSession } from "@/lib/session";

async function access(request: Request) {
  const session = await getPhotosProductSession();
  if (!session) return null;
  const parsed = spaceIdSchema.safeParse(
    new URL(request.url).searchParams.get("spaceId"),
  );
  if (!parsed.success) return null;
  await resolveSpaceAccess({
    accountId: session.accountId,
    spaceId: parsed.data,
    productId: "photos",
  });
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
  const albums = await PhotoAlbumV2.find({ spaceId: context.spaceId })
    .sort({ updatedAt: -1 })
    .lean();
  return Response.json({ albums });
}

export async function POST(request: Request) {
  let context;
  try {
    context = await access(request);
  } catch {
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
    typeof body.encryptedName !== "string" ||
    body.encryptedName.length < 16 ||
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
      encryptedName: body.encryptedName,
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
