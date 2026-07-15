import { spaceIdSchema } from "@xenode/contracts";
import { getDatabase, getMongoose } from "@xenode/database";
import { PhotosService } from "@xenode/photos";
import { resolveSpaceAccess } from "@xenode/spaces";
import { MongoPhotosRepository } from "@/lib/photos-repository";
import { getPhotosProductSession } from "@/lib/session";

export async function POST(request: Request) {
  const session = await getPhotosProductSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const parsedSpaceId = spaceIdSchema.safeParse(body?.spaceId);
  const takenAt =
    typeof body?.takenAt === "string" ? new Date(body.takenAt) : null;
  if (
    !body ||
    !parsedSpaceId.success ||
    typeof body.storageObjectId !== "string" ||
    !getMongoose().Types.ObjectId.isValid(body.storageObjectId) ||
    (body.mediaType !== "image" && body.mediaType !== "video") ||
    !takenAt ||
    Number.isNaN(takenAt.getTime()) ||
    (body.assetId !== undefined && typeof body.assetId !== "string") ||
    (body.syncContentFingerprint !== undefined &&
      typeof body.syncContentFingerprint !== "string")
  ) {
    return Response.json({ error: "Invalid photo asset" }, { status: 400 });
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
  const objectId = new (getMongoose().Types.ObjectId)(body.storageObjectId);
  const object = await getDatabase().collection("storageobjects").findOne({
    _id: objectId,
    spaceId: parsedSpaceId.data,
    isEncrypted: true,
  });
  if (!object) {
    return Response.json(
      { error: "Encrypted storage object not found in this Space" },
      { status: 404 },
    );
  }

  const service = new PhotosService(new MongoPhotosRepository());
  try {
    const asset = await service.createProjection({
      id:
        typeof body.assetId === "string" && body.assetId
          ? body.assetId
          : crypto.randomUUID(),
      spaceId: parsedSpaceId.data,
      storageObjectId: body.storageObjectId,
      mediaType: body.mediaType,
      takenAt,
      width: typeof body.width === "number" ? body.width : undefined,
      height: typeof body.height === "number" ? body.height : undefined,
      durationMs:
        typeof body.durationMs === "number" ? body.durationMs : undefined,
      encryptedMetadata:
        typeof body.encryptedMetadata === "string"
          ? body.encryptedMetadata
          : undefined,
      uploadSource:
        typeof body.uploadSource === "string" ? body.uploadSource : "web",
      status: "active",
      createdByAccountId: session.accountId,
      syncContentFingerprint:
        typeof body.syncContentFingerprint === "string"
          ? body.syncContentFingerprint
          : undefined,
    });
    return Response.json({ asset }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Projection failed" },
      { status: 409 },
    );
  }
}
