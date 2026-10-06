import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { regionForBucketName } from "@xenode/config/storage";
import { getS3Client } from "./client";

export const FILE_URL_MAX_TTL_SECONDS = 300;

/** Round down so a capability never outlives its authorization deadline. */
export function fileUrlLifetime(deadline?: Date | null, now = Date.now()): number {
  const remaining = deadline == null ? FILE_URL_MAX_TTL_SECONDS : Math.floor((deadline.getTime() - now) / 1000);
  if (!Number.isFinite(remaining) || remaining < 1) throw new Error("File authorization has expired");
  return Math.min(FILE_URL_MAX_TTL_SECONDS, remaining);
}

/** Direct ciphertext GET. Range is deliberately unsigned for browser seeking. */
export async function getSignedFileUrl(bucketName: string, key: string, expiresIn = FILE_URL_MAX_TTL_SECONDS): Promise<string> {
  if (!Number.isSafeInteger(expiresIn) || expiresIn < 1 || !key || key.length > 1024) throw new Error("Invalid file URL request");
  return getSignedUrl(getS3Client(regionForBucketName(bucketName)), new GetObjectCommand({
    Bucket: bucketName, Key: key,
    ResponseContentType: "application/octet-stream",
    ResponseCacheControl: "private, no-store",
    ResponseContentDisposition: "attachment",
  }), { expiresIn: Math.min(expiresIn, FILE_URL_MAX_TTL_SECONDS) });
}

/** Public application assets live on a separately configured public domain. */
export function getPublicB2Url(_bucketName: string, key: string): string {
  void _bucketName;
  const base = process.env.PUBLIC_S3_ENDPOINT;
  if (!base) throw new Error("PUBLIC_S3_ENDPOINT is required for public R2 assets");
  const url = new URL(base);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("PUBLIC_S3_ENDPOINT must be an HTTPS public origin");
  return `${url.origin}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
