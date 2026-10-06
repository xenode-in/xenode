import { cleanupPhotoUploadRecord } from "@xenode/database";
import { deletePhotoCiphertext } from "./storage-delete";

/** Photos storage adapter; the database repository owns expiry, claims and retirement. */
export async function cleanupPhotoUpload(params: {
  uploadId: string; accountId: string; spaceId: string; expiredAt?: Date; now?: Date;
}) {
  return cleanupPhotoUploadRecord({
    ...params,
    async deleteBlobs({ bucketId, keys }) { await deletePhotoCiphertext(bucketId, keys); },
  });
}
