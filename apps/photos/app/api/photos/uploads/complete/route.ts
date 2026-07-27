import { DeleteObjectsCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { PhotoAsset, getDatabase, getMongoose } from "@xenode/database";
import { personalSpaceId, resolveSpaceAccess } from "@xenode/spaces";
import { getPhotosProductSession } from "@/lib/session";
import { getPhotosStorageContext } from "@/lib/storage-server";

const MAX_ENCRYPTED_UPLOAD_BYTES = 250 * 1024 * 1024 + 16;
const MAX_ENCRYPTED_DERIVATIVE_BYTES = 25 * 1024 * 1024 + 16;

type CompleteBody = {
  assetId?: unknown;
  bucketId?: unknown;
  encryptedDEK?: unknown;
  height?: unknown;
  iv?: unknown;
  mediaType?: unknown;
  objectKey?: unknown;
  optimizedContentType?: unknown;
  optimizedEncryptedDEK?: unknown;
  optimizedIV?: unknown;
  optimizedKey?: unknown;
  optimizedSize?: unknown;
  optimizedSpaceKeyWrapIv?: unknown;
  originalContentType?: unknown;
  size?: unknown;
  spaceKeyWrapIv?: unknown;
  takenAt?: unknown;
  thumbnailContentType?: unknown;
  thumbnailEncryptedDEK?: unknown;
  thumbnailIV?: unknown;
  thumbnailKey?: unknown;
  thumbnailSize?: unknown;
  thumbnailSpaceKeyWrapIv?: unknown;
  width?: unknown;
};

type EncryptedVariant = {
  contentType: string;
  encryptedDEK: string;
  iv: string;
  key: string;
  size: number;
  spaceKeyWrapIv: string;
};

export async function POST(request: Request) {
  const session = await getPhotosProductSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CompleteBody | null;
  const takenAt =
    typeof body?.takenAt === "string" ? new Date(body.takenAt) : null;
  const original = body
    ? parseVariant(body, "", MAX_ENCRYPTED_UPLOAD_BYTES)
    : null;
  const optimized = body
    ? parseVariant(body, "optimized", MAX_ENCRYPTED_DERIVATIVE_BYTES)
    : null;
  const thumbnail = body
    ? parseVariant(body, "thumbnail", MAX_ENCRYPTED_DERIVATIVE_BYTES)
    : null;
  const isImage = body?.mediaType === "image";
  if (
    !body ||
    typeof body.assetId !== "string" ||
    !body.assetId ||
    typeof body.bucketId !== "string" ||
    !getMongoose().Types.ObjectId.isValid(body.bucketId) ||
    !original ||
    !takenAt ||
    Number.isNaN(takenAt.getTime()) ||
    (body.mediaType !== "image" && body.mediaType !== "video") ||
    (isImage &&
      (!original.contentType.startsWith("image/") ||
        !optimized ||
        optimized.contentType !== "image/jpeg" ||
        !thumbnail ||
        thumbnail.contentType !== "image/jpeg")) ||
    (body.mediaType === "video" &&
      !original.contentType.startsWith("video/"))
  ) {
    return Response.json({ error: "Invalid upload completion" }, { status: 400 });
  }

  const variants = [
    original,
    ...(optimized ? [optimized] : []),
    ...(thumbnail ? [thumbnail] : []),
  ];
  try {
    const spaceId = personalSpaceId(session.accountId);
    await resolveSpaceAccess({
      accountId: session.accountId,
      spaceId,
      productId: "photos",
    });
    const storage = await getPhotosStorageContext(session.accountId);
    if (
      storage.bucket._id.toString() !== body.bucketId ||
      variants.some(
        (variant) => !isAccountObjectKey(variant.key, session.accountId),
      ) ||
      new Set(variants.map((variant) => variant.key)).size !== variants.length
    ) {
      return Response.json(
        { error: "Invalid regional bucket or object key" },
        { status: 403 },
      );
    }

    const database = getDatabase();
    const storageObjects = database.collection("storageobjects");
    const existingAsset = await PhotoAsset.findOne({
      assetId: body.assetId,
      spaceId,
      createdByAccountId: session.accountId,
    }).lean();
    if (existingAsset) {
      const existingObject = getMongoose().Types.ObjectId.isValid(
        existingAsset.storageObjectId,
      )
        ? await storageObjects.findOne({
            _id: new (getMongoose().Types.ObjectId)(
              existingAsset.storageObjectId,
            ),
            productId: "photos",
          })
        : null;
      const referencedKeys = new Set(
        [
          existingObject?.key,
          existingObject?.optimizedKey,
          existingObject?.thumbnail,
        ].filter((key): key is string => typeof key === "string"),
      );
      await deleteUploadedObjects(
        storage,
        variants
          .map((variant) => variant.key)
          .filter((key) => !referencedKeys.has(key)),
      );
      return Response.json({ asset: existingAsset });
    }

    const heads = await Promise.all(
      variants.map((variant) =>
        storage.client.send(
          new HeadObjectCommand({
            Bucket: storage.bucket.b2BucketId,
            Key: variant.key,
          }),
        ),
      ),
    );
    if (
      heads.some(
        (head, index) => head.ContentLength !== variants[index]?.size,
      )
    ) {
      await deleteUploadedObjects(
        storage,
        variants.map((variant) => variant.key),
      );
      return Response.json(
        { error: "Uploaded object size mismatch" },
        { status: 400 },
      );
    }

    const objectWithKey = await storageObjects.findOne({
      key: original.key,
      productId: "photos",
      spaceId,
      createdByAccountId: session.accountId,
    });
    if (objectWithKey) {
      const completedAsset = await PhotoAsset.findOne({
        storageObjectId: objectWithKey._id.toString(),
        spaceId,
        createdByAccountId: session.accountId,
      }).lean();
      if (completedAsset) {
        return Response.json({ asset: completedAsset });
      }
      await deleteUploadedObjects(
        storage,
        variants.map((variant) => variant.key),
      );
      return Response.json(
        { error: "Upload metadata is incomplete; please upload the file again" },
        { status: 409 },
      );
    }

    const usages = database.collection("usages");
    const usage = await usages.findOne({ userId: session.accountId });
    if (!usage || !Number.isFinite(usage.totalStorageBytes)) {
      await deleteUploadedObjects(
        storage,
        variants.map((variant) => variant.key),
      );
      return Response.json(
        { error: "Storage usage is not initialized; complete onboarding first" },
        { status: 409 },
      );
    }
    const totalStorageSize = variants.reduce(
      (total, variant) => total + variant.size,
      0,
    );
    const quotaFilter =
      usage.storageLimitBytes === null
        ? { userId: session.accountId }
        : typeof usage.storageLimitBytes === "number"
          ? {
              userId: session.accountId,
              totalStorageBytes: {
                $lte: usage.storageLimitBytes - totalStorageSize,
              },
            }
          : null;
    if (!quotaFilter) {
      await deleteUploadedObjects(
        storage,
        variants.map((variant) => variant.key),
      );
      return Response.json(
        { error: "Storage limit is not initialized; complete onboarding first" },
        { status: 409 },
      );
    }
    const now = new Date();
    const reservedUsage = await usages.findOneAndUpdate(
      quotaFilter,
      {
        $inc: {
          totalStorageBytes: totalStorageSize,
          totalObjects: 1,
          uploadCount: 1,
        },
        $set: { lastActiveAt: now, updatedAt: now },
      },
      { returnDocument: "after" },
    );
    if (!reservedUsage) {
      await deleteUploadedObjects(
        storage,
        variants.map((variant) => variant.key),
      );
      return Response.json({ error: "Storage quota exceeded" }, { status: 402 });
    }

    const objectId = new (getMongoose().Types.ObjectId)();
    let bucketStatsUpdated = false;
    try {
      await storageObjects.insertOne({
        _id: objectId,
        productId: "photos",
        bucketId: storage.bucket._id,
        spaceId,
        createdByAccountId: session.accountId,
        key: original.key,
        size: original.size,
        contentType: "application/octet-stream",
        originalContentType: original.contentType,
        mediaCategory: body.mediaType,
        b2FileId:
          heads[0]?.VersionId ??
          `${storage.bucket.b2BucketId}/${original.key}`,
        tags: [],
        position: 0,
        uploadSource: "web",
        isEncrypted: true,
        encryptedDEK: original.encryptedDEK,
        wrappedBy: "space",
        spaceKeyVersion: 1,
        spaceKeyWrapIv: original.spaceKeyWrapIv,
        iv: original.iv,
        optimizedKey: optimized?.key,
        optimizedSize: optimized?.size,
        optimizedContentType: optimized?.contentType,
        optimizedEncryptedDEK: optimized?.encryptedDEK,
        optimizedIV: optimized?.iv,
        optimizedSpaceKeyWrapIv: optimized?.spaceKeyWrapIv,
        thumbnail: thumbnail?.key,
        thumbnailSize: thumbnail?.size,
        thumbnailContentType: thumbnail?.contentType,
        thumbnailEncryptedDEK: thumbnail?.encryptedDEK,
        thumbnailIV: thumbnail?.iv,
        thumbnailSpaceKeyWrapIv: thumbnail?.spaceKeyWrapIv,
        takenAt,
        aspectRatio:
          typeof body.width === "number" &&
          typeof body.height === "number" &&
          body.width > 0 &&
          body.height > 0
            ? body.width / body.height
            : undefined,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      const asset = await PhotoAsset.create({
        assetId: body.assetId,
        spaceId,
        storageObjectId: objectId.toString(),
        mediaType: body.mediaType,
        takenAt,
        width:
          typeof body.width === "number" && body.width > 0
            ? Math.round(body.width)
            : undefined,
        height:
          typeof body.height === "number" && body.height > 0
            ? Math.round(body.height)
            : undefined,
        uploadSource: "web",
        status: "active",
        createdByAccountId: session.accountId,
      });
      const bucketUpdate = await database.collection("buckets").updateOne(
        { _id: storage.bucket._id },
        {
          $inc: { objectCount: 1, totalSizeBytes: totalStorageSize },
          $set: { updatedAt: new Date() },
        },
      );
      if (bucketUpdate.matchedCount !== 1) {
        throw new Error("Regional bucket metadata disappeared during upload");
      }
      bucketStatsUpdated = true;
      return Response.json({ asset }, { status: 201 });
    } catch (error) {
      await Promise.all([
        PhotoAsset.deleteOne({
          assetId: body.assetId,
          spaceId,
          createdByAccountId: session.accountId,
        }),
        storageObjects.deleteOne({ _id: objectId }),
        usages.updateOne(
          { userId: session.accountId },
          {
            $inc: {
              totalStorageBytes: -totalStorageSize,
              totalObjects: -1,
              uploadCount: -1,
            },
            $set: { updatedAt: new Date() },
          },
        ),
        bucketStatsUpdated
          ? database.collection("buckets").updateOne(
              { _id: storage.bucket._id },
              {
                $inc: {
                  objectCount: -1,
                  totalSizeBytes: -totalStorageSize,
                },
                $set: { updatedAt: new Date() },
              },
            )
          : Promise.resolve(),
        deleteUploadedObjects(
          storage,
          variants.map((variant) => variant.key),
        ),
      ]);
      throw error;
    }
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not complete upload",
      },
      { status: 500 },
    );
  }
}

function parseVariant(
  body: CompleteBody,
  prefix: "" | "optimized" | "thumbnail",
  maxSize: number,
): EncryptedVariant | null {
  const values = body as Record<string, unknown>;
  const keyName = prefix ? `${prefix}Key` : "objectKey";
  const sizeName = prefix ? `${prefix}Size` : "size";
  const contentTypeName = prefix
    ? `${prefix}ContentType`
    : "originalContentType";
  const dekName = prefix ? `${prefix}EncryptedDEK` : "encryptedDEK";
  const ivName = prefix ? `${prefix}IV` : "iv";
  const wrapIvName = prefix
    ? `${prefix}SpaceKeyWrapIv`
    : "spaceKeyWrapIv";
  const key = values[keyName];
  const size = Number(values[sizeName]);
  const contentType = values[contentTypeName];
  const encryptedDEK = values[dekName];
  const iv = values[ivName];
  const spaceKeyWrapIv = values[wrapIvName];
  if (
    typeof key !== "string" ||
    typeof contentType !== "string" ||
    !contentType ||
    typeof encryptedDEK !== "string" ||
    !encryptedDEK ||
    typeof iv !== "string" ||
    !iv ||
    typeof spaceKeyWrapIv !== "string" ||
    !spaceKeyWrapIv ||
    !Number.isSafeInteger(size) ||
    size <= 16 ||
    size > maxSize
  ) {
    return null;
  }
  return { key, size, contentType, encryptedDEK, iv, spaceKeyWrapIv };
}

function isAccountObjectKey(key: string, accountId: string): boolean {
  return new RegExp(
    `^users/${escapeRegex(accountId)}/[a-f0-9]{32}$`,
    "u",
  ).test(key);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function deleteUploadedObjects(
  storage: Awaited<ReturnType<typeof getPhotosStorageContext>>,
  keys: string[],
) {
  if (keys.length === 0) return;
  await storage.client
    .send(
      new DeleteObjectsCommand({
        Bucket: storage.bucket.b2BucketId,
        Delete: {
          Objects: keys.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    )
    .catch(() => {});
}
