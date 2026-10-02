import { describe, expect, it } from "vitest";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

describe("R2 write-once PUT signature", () => {
  it("binds If-None-Match to the presigned URL", async () => {
    const client = new S3Client({
      endpoint: "https://example.r2.cloudflarestorage.com",
      region: "auto",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      forcePathStyle: true,
    });
    const signed = await getSignedUrl(client, new PutObjectCommand({
      Bucket: "test-bucket", Key: "users/test/key", ContentType: "application/octet-stream",
      IfNoneMatch: "*",
    }), { expiresIn: 3600 });
    const url = new URL(signed);
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain("if-none-match");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain("host");
  });
});
