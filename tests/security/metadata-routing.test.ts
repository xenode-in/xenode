import { describe, expect, it } from "vitest";
import { inspectFileHeader } from "@/lib/file-security/inspection";
import { extractFileMetadata } from "@/lib/metadata/metadataClient";

describe("upload metadata signature routing", () => {
  it("does not send a MIME-confused file to image or media parsers", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n");
    const file = new File(
      [bytes],
      "photo.jpg",
      { type: "image/jpeg", lastModified: 1 },
    );
    const result = await extractFileMetadata(file);
    expect(result.metadata.mediaCategory).toBe("other");
    expect(result.rawThumbnail).toBeUndefined();
  });

  it("reads canonical VP8X dimensions before browser decoding", () => {
    const bytes = new Uint8Array(30);
    bytes.set(new TextEncoder().encode("RIFF"), 0);
    bytes.set(new TextEncoder().encode("WEBP"), 8);
    bytes.set(new TextEncoder().encode("VP8X"), 12);
    const width = 640 - 1;
    const height = 360 - 1;
    bytes[24] = width & 0xff;
    bytes[25] = (width >>> 8) & 0xff;
    bytes[26] = (width >>> 16) & 0xff;
    bytes[27] = height & 0xff;
    bytes[28] = (height >>> 8) & 0xff;
    bytes[29] = (height >>> 16) & 0xff;
    const inspected = inspectFileHeader(
      bytes,
      "photo.webp",
      "image/webp",
      bytes.length,
    );
    expect(inspected.imageMetrics).toMatchObject({ width: 640, height: 360 });
    expect(inspected.signatureMatched).toBe(true);
  });
});
