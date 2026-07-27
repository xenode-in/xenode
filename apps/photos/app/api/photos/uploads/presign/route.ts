import { randomBytes } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requirePhotoMedia } from "@xenode/media-processing";
import { getPhotosProductSession } from "@/lib/session";
import { getPhotosStorageContext } from "@/lib/storage-server";

const MAX_DIRECT_UPLOAD_BYTES = 250 * 1024 * 1024;
const MAX_DERIVATIVE_BYTES = 25 * 1024 * 1024;

type UploadVariant = {
  objectKey: string;
  uploadUrl: string;
};

export async function POST(request: Request) {
  const session = await getPhotosProductSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const fileSize = Number(body?.fileSize);
  const contentType =
    typeof body?.mediaType === "string" ? body.mediaType : "";
  const optimizedSize = Number(body?.optimizedSize);
  const thumbnailSize = Number(body?.thumbnailSize);
  let mediaType: "image" | "video";
  try {
    mediaType = requirePhotoMedia(contentType);
  } catch {
    return Response.json(
      { error: "Photos accepts only images and videos" },
      { status: 400 },
    );
  }
  if (
    !Number.isSafeInteger(fileSize) ||
    fileSize <= 16 ||
    fileSize > MAX_DIRECT_UPLOAD_BYTES + 16
  ) {
    return Response.json(
      { error: "Invalid file size or file exceeds the 250 MB web limit" },
      { status: 400 },
    );
  }
  if (
    mediaType === "image" &&
    (!Number.isSafeInteger(optimizedSize) ||
      optimizedSize <= 16 ||
      optimizedSize > MAX_DERIVATIVE_BYTES ||
      !Number.isSafeInteger(thumbnailSize) ||
      thumbnailSize <= 16 ||
      thumbnailSize > MAX_DERIVATIVE_BYTES)
  ) {
    return Response.json(
      { error: "Images require valid optimized and thumbnail sizes" },
      { status: 400 },
    );
  }

  try {
    const storage = await getPhotosStorageContext(session.accountId);
    const original = await createUploadVariant(session.accountId, storage);
    const optimized =
      mediaType === "image"
        ? await createUploadVariant(session.accountId, storage)
        : undefined;
    const thumbnail =
      mediaType === "image"
        ? await createUploadVariant(session.accountId, storage)
        : undefined;
    return Response.json({
      original,
      optimized,
      thumbnail,
      // Kept temporarily for older clients during a rolling deployment.
      uploadUrl: original.uploadUrl,
      objectKey: original.objectKey,
      bucketId: storage.bucket._id.toString(),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not prepare upload",
      },
      { status: 500 },
    );
  }
}

async function createUploadVariant(
  accountId: string,
  storage: Awaited<ReturnType<typeof getPhotosStorageContext>>,
): Promise<UploadVariant> {
  const objectKey = `users/${accountId}/${randomBytes(16).toString("hex")}`;
  const uploadUrl = await getSignedUrl(
    storage.client,
    new PutObjectCommand({
      Bucket: storage.bucket.b2BucketId,
      Key: objectKey,
      ContentType: "application/octet-stream",
    }),
    { expiresIn: 3600 },
  );
  return { objectKey, uploadUrl };
}
