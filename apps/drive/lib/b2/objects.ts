import {
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client } from "./client";
import { getSignedFileUrl } from "./cdn";
import { regionForBucketName } from "@xenode/config/storage";

export interface B2ObjectInfo {
  key: string;
  size: number;
  lastModified?: Date;
  contentType?: string;
}

/**
 * Upload an object to a B2 bucket
 */
export async function uploadObject(
  bucketName: string,
  key: string,
  body: Buffer | ReadableStream | Uint8Array,
  contentType: string = "application/octet-stream",
  size?: number,
  client?: S3Client,
): Promise<{ etag: string; b2FileId: string }> {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
    ContentLength: size,
  });

  const targetClient =
    client ?? getS3Client(regionForBucketName(bucketName));
  const response = await targetClient.send(command);
  return {
    etag: response.ETag || "",
    b2FileId: response.VersionId || `${bucketName}/${key}`,
  };
}

/**
 * Delete an object from a B2 bucket
 */
export async function deleteObject(
  bucketName: string,
  key: string,
): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  await getS3Client(regionForBucketName(bucketName)).send(command);
}

/**
 * Delete many objects from a B2 bucket in one round trip per 1000 keys.
 *
 * S3's DeleteObjects API accepts up to 1000 keys per request, so we chunk.
 * Best-effort: a chunk that fails (or reports per-key errors) is logged but
 * doesn't throw — the caller (bulk-delete) has already decided the records
 * are going away, and any B2 key we miss is harmless orphaned ciphertext.
 * Duplicate/empty keys are de-duped out first.
 */
export async function deleteObjects(
  bucketName: string,
  keys: string[],
): Promise<void> {
  const unique = Array.from(new Set(keys.filter(Boolean)));
  if (unique.length === 0) return;

  const CHUNK = 1000;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    try {
      await getS3Client(regionForBucketName(bucketName)).send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: {
            Objects: slice.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    } catch (e) {
      console.error(
        `[b2] deleteObjects chunk failed (${slice.length} keys):`,
        e,
      );
    }
  }
}

/**
 * List objects in a B2 bucket with optional prefix filtering
 */
export async function listObjects(
  bucketName: string,
  prefix?: string,
  maxKeys: number = 1000,
  continuationToken?: string,
): Promise<{
  objects: B2ObjectInfo[];
  nextContinuationToken?: string;
  isTruncated: boolean;
}> {
  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: prefix,
    MaxKeys: maxKeys,
    ContinuationToken: continuationToken,
  });

  const response = await getS3Client(regionForBucketName(bucketName)).send(command);

  const objects: B2ObjectInfo[] = (response.Contents || []).map((obj) => ({
    key: obj.Key || "",
    size: obj.Size || 0,
    lastModified: obj.LastModified,
  }));

  return {
    objects,
    nextContinuationToken: response.NextContinuationToken,
    isTruncated: response.IsTruncated || false,
  };
}

/**
 * Get object metadata without downloading the body
 */
export async function getObjectMetadata(
  bucketName: string,
  key: string,
): Promise<{ size: number; contentType: string; lastModified?: Date }> {
  const command = new HeadObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  const response = await getS3Client(regionForBucketName(bucketName)).send(command);
  return {
    size: response.ContentLength || 0,
    contentType: response.ContentType || "application/octet-stream",
    lastModified: response.LastModified,
  };
}

/**
 * Generate a URL for downloading an object.
 * If AZURE_CDN_URL is set, returns a signed proxy URL routed through Azure CDN
 * (private-bucket safe — token validated server-side before B2 access).
 * Otherwise falls back to a short-lived pre-signed B2 URL.
 */
export async function getDownloadUrl(
  bucketName: string,
  key: string,
  expiresIn: number = 3600,
  version?: string,
): Promise<string> {
  // Always route through our proxy so we can benefit from AZURE_CDN_URL
  // or handle custom stream processing (like range requests) uniformly.
  return getSignedFileUrl(bucketName, key, expiresIn, version);
}

/**
 * Generate a pre-signed URL for uploading an object
 */
export async function getUploadUrl(
  bucketName: string,
  key: string,
  contentType: string = "application/octet-stream",
  expiresIn: number = 3600,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(
    getS3Client(regionForBucketName(bucketName)),
    command,
    { expiresIn },
  );
}

/**
 * Copy an object within B2 (or between buckets)
 */
export async function copyObject(
  sourceBucket: string,
  sourceKey: string,
  destinationBucket: string,
  destinationKey: string,
): Promise<void> {
  const sourceRegion = regionForBucketName(sourceBucket);
  const destinationRegion = regionForBucketName(destinationBucket);
  const sourceClient = getS3Client(sourceRegion);
  const destinationClient = getS3Client(destinationRegion);
  // Encode each segment while preserving path separators. Encoding the whole
  // key turns "/" into "%2F", which some S3-compatible providers (including
  // B2 configurations) interpret as a different source key.
  const encodedSourceKey = sourceKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  try {
    if (sourceRegion !== destinationRegion) {
      throw new Error("Cross-region CopyObject requires streamed copy");
    }
    await sourceClient.send(
      new CopyObjectCommand({
        CopySource: `/${sourceBucket}/${encodedSourceKey}`,
        Bucket: destinationBucket,
        Key: destinationKey,
      }),
    );
  } catch (copyError) {
    // Some restricted B2 application keys can read and write objects but do
    // not permit server-side CopyObject. Fall back to a streamed GET -> PUT.
    console.warn("[b2] CopyObject failed; using streamed copy fallback", {
      sourceBucket,
      sourceKey,
      destinationBucket,
      destinationKey,
      error:
        copyError instanceof Error ? copyError.message : String(copyError),
    });
    const source = await sourceClient.send(
      new GetObjectCommand({ Bucket: sourceBucket, Key: sourceKey }),
    );
    if (!source.Body) throw new Error("Source object body is empty");
    await destinationClient.send(
      new PutObjectCommand({
        Bucket: destinationBucket,
        Key: destinationKey,
        Body: source.Body,
        ContentType: source.ContentType,
        ContentLength: source.ContentLength,
        CacheControl: source.CacheControl,
        ContentDisposition: source.ContentDisposition,
        ContentEncoding: source.ContentEncoding,
        Metadata: source.Metadata,
      }),
    );
  }
}
