import { Upload } from "@aws-sdk/lib-storage";
import { getS3Client } from "../../b2/client";
import { Readable } from "stream";
import { Progress } from "@aws-sdk/lib-storage";

export async function uploadStreamToB2(
  bucketName: string,
  key: string,
  body: Readable,
  contentType: string,
  onProgress?: (progress: Progress) => void
): Promise<{ etag: string; b2FileId: string }> {
  const upload = new Upload({
    client: getS3Client(),
    params: {
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    },
    queueSize: 4, // 4 concurrent parts
    partSize: 5 * 1024 * 1024, // 5MB chunks
    leavePartsOnError: false, // Clean up on failure
  });

  if (onProgress) {
    upload.on("httpUploadProgress", onProgress);
  }

  const response = await upload.done();

  return {
    etag: response.ETag || "",
    b2FileId: response.VersionId || `${bucketName}/${key}`,
  };
}
