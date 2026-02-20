import {
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client } from "./client";
import { getSignedFileUrl } from "./cdn";

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
): Promise<{ etag: string; b2FileId: string }> {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
    ContentLength: size,
  });

  const response = await getS3Client().send(command);
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

  await getS3Client().send(command);
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

  const response = await getS3Client().send(command);

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

  const response = await getS3Client().send(command);
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
): Promise<string> {
  if (process.env.AZURE_CDN_URL) {
    return getSignedFileUrl(bucketName, key, expiresIn);
  }

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  return getSignedUrl(getS3Client(), command, { expiresIn });
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

  return getSignedUrl(getS3Client(), command, { expiresIn });
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
  const command = new CopyObjectCommand({
    CopySource: `${sourceBucket}/${encodeURIComponent(sourceKey)}`,
    Bucket: destinationBucket,
    Key: destinationKey,
  });

  await getS3Client().send(command);
}
