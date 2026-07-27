import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PhotoAsset, getDatabase, getMongoose } from "@xenode/database";
import { personalSpaceId, resolveSpaceAccess } from "@xenode/spaces";
import { getPhotosProductSession } from "@/lib/session";
import { getPhotosStorageContext } from "@/lib/storage-server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const session = await getPhotosProductSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { assetId } = await params;
  const spaceId = personalSpaceId(session.accountId);
  try {
    await resolveSpaceAccess({
      accountId: session.accountId,
      spaceId,
      productId: "photos",
    });
    const asset = await PhotoAsset.findOne({
      assetId,
      spaceId,
      status: "active",
    }).lean();
    if (
      !asset ||
      !getMongoose().Types.ObjectId.isValid(asset.storageObjectId)
    ) {
      return Response.json({ error: "Photo not found" }, { status: 404 });
    }
    const object = await getDatabase().collection("storageobjects").findOne({
      _id: new (getMongoose().Types.ObjectId)(asset.storageObjectId),
      spaceId,
      createdByAccountId: session.accountId,
      productId: "photos",
      isEncrypted: true,
      deletedAt: { $exists: false },
    });
    if (
      !object ||
      typeof object.key !== "string"
    ) {
      return Response.json({ error: "Encrypted photo not found" }, { status: 404 });
    }
    const storage = await getPhotosStorageContext(session.accountId);
    if (String(object.bucketId) !== storage.bucket._id.toString()) {
      return Response.json({ error: "Photo bucket mismatch" }, { status: 409 });
    }
    const requestedVariant = new URL(request.url).searchParams.get("variant");
    const content = selectContentVariant(object, requestedVariant);
    if (!content) {
      return Response.json(
        { error: "Encrypted photo content is incomplete" },
        { status: 409 },
      );
    }
    const url = await getSignedUrl(
      storage.client,
      new GetObjectCommand({
        Bucket: storage.bucket.b2BucketId,
        Key: content.objectKey,
      }),
      { expiresIn: 300 },
    );
    return Response.json({
      url,
      accountId: session.accountId,
      spaceId,
      objectKey: content.objectKey,
      encryptedDEK: content.encryptedDEK,
      iv: content.iv,
      spaceKeyWrapIv: content.spaceKeyWrapIv,
      contentType: content.contentType,
      variant: content.variant,
      mediaType: asset.mediaType,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not load photo",
      },
      { status: 500 },
    );
  }
}

type StoredObject = Record<string, unknown>;

function selectContentVariant(
  object: StoredObject,
  requestedVariant: string | null,
) {
  const original = variantFromFields(object, {
    variant: "original",
    key: "key",
    contentType: "originalContentType",
    encryptedDEK: "encryptedDEK",
    iv: "iv",
    spaceKeyWrapIv: "spaceKeyWrapIv",
  });
  const optimized = variantFromFields(object, {
    variant: "optimized",
    key: "optimizedKey",
    contentType: "optimizedContentType",
    encryptedDEK: "optimizedEncryptedDEK",
    iv: "optimizedIV",
    spaceKeyWrapIv: "optimizedSpaceKeyWrapIv",
  });
  const thumbnail = variantFromFields(object, {
    variant: "thumbnail",
    key: "thumbnail",
    contentType: "thumbnailContentType",
    encryptedDEK: "thumbnailEncryptedDEK",
    iv: "thumbnailIV",
    spaceKeyWrapIv: "thumbnailSpaceKeyWrapIv",
  });
  if (requestedVariant === "original") return original;
  if (requestedVariant === "optimized") return optimized ?? original;
  return thumbnail ?? optimized ?? original;
}

function variantFromFields(
  object: StoredObject,
  fields: {
    variant: "original" | "optimized" | "thumbnail";
    key: string;
    contentType: string;
    encryptedDEK: string;
    iv: string;
    spaceKeyWrapIv: string;
  },
) {
  const objectKey = object[fields.key];
  const encryptedDEK = object[fields.encryptedDEK];
  const iv = object[fields.iv];
  const spaceKeyWrapIv = object[fields.spaceKeyWrapIv];
  if (
    typeof objectKey !== "string" ||
    typeof encryptedDEK !== "string" ||
    typeof iv !== "string" ||
    typeof spaceKeyWrapIv !== "string"
  ) {
    return null;
  }
  return {
    variant: fields.variant,
    objectKey,
    encryptedDEK,
    iv,
    spaceKeyWrapIv,
    contentType:
      typeof object[fields.contentType] === "string"
        ? object[fields.contentType]
        : "application/octet-stream",
  };
}
