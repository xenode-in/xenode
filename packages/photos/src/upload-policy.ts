import {
  requirePhotoMedia,
  type EncryptedMediaMetadata,
  type MediaKind,
  type MetadataProcessor,
} from "@xenode/media-processing";
import type { UploadInput, UploadPolicy } from "@xenode/upload-engine";

export interface PreparedPhotoUpload {
  mediaType: MediaKind;
  metadata: EncryptedMediaMetadata;
  encryptedPreview?: string;
  uploadSource: Blob;
}

export interface PhotosMediaPipeline extends MetadataProcessor {
  createEncryptedPreview(
    source: Blob,
    mediaType: MediaKind,
  ): Promise<string | undefined>;
  optimizeVideoForFastStart?(source: Blob): Promise<Blob>;
}

export class PhotosUploadPolicy implements UploadPolicy {
  private readonly prepared = new Map<string, PreparedPhotoUpload>();

  constructor(private readonly pipeline: PhotosMediaPipeline) {}

  async validate(input: UploadInput): Promise<void> {
    if (
      !Number.isSafeInteger(input.size) ||
      input.size <= 0 ||
      !(input.source instanceof Blob)
    ) {
      throw new Error("Photos upload source is invalid");
    }
    const mediaType = requirePhotoMedia(input.contentType);
    const metadata = await this.pipeline.extract(input.source);
    const encryptedPreview = await this.pipeline.createEncryptedPreview(
      input.source,
      mediaType,
    );
    const uploadSource =
      mediaType === "video" && this.pipeline.optimizeVideoForFastStart
        ? await this.pipeline.optimizeVideoForFastStart(input.source)
        : input.source;
    this.prepared.set(input.id, {
      mediaType,
      metadata,
      encryptedPreview,
      uploadSource,
    });
  }

  takePreparation(uploadId: string): PreparedPhotoUpload {
    const preparation = this.prepared.get(uploadId);
    if (!preparation) throw new Error("Photo upload was not prepared");
    this.prepared.delete(uploadId);
    return preparation;
  }

  discard(uploadId: string): void {
    this.prepared.delete(uploadId);
  }
}
