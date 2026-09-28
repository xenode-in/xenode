import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { PhotoUpload, findReferencedStorageObjectKeys } from "@xenode/database";
import { assertSpaceAction, personalSpaceId, resolveSpaceAccess } from "@xenode/spaces";
import { getPhotosProductSession } from "@/lib/session";
import { getPhotosStorageContext } from "@/lib/storage-server";

/** Delete only ciphertext keys reserved by this account's Photos upload. */
export async function POST(request: Request) {
  const session = await getPhotosProductSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { uploadId?: unknown } | null;
  if (typeof body?.uploadId !== "string" || !body.uploadId) {
    return Response.json({ error: "uploadId required" }, { status: 400 });
  }
  try {
    const spaceId = personalSpaceId(session.accountId);
    const access = await resolveSpaceAccess({
      accountId: session.accountId, spaceId, productId: "photos",
    });
    assertSpaceAction(access, "write");
    const storage = await getPhotosStorageContext(session.accountId);
    const manifest = await PhotoUpload.findOne({
      uploadId: body.uploadId,
      accountId: session.accountId,
      spaceId,
      bucketId: storage.bucket._id,
      status: { $in: ["pending", "aborting"] },
    });
    if (!manifest) {
      return Response.json({ error: "Photo upload is no longer abortable" }, { status: 409 });
    }
    if (manifest.status === "pending") {
      const claimed = await PhotoUpload.findOneAndUpdate(
        { _id: manifest._id, status: "pending" },
        { $set: { status: "aborting" } },
        { returnDocument: "after" },
      );
      if (!claimed) {
        return Response.json({ error: "Photo upload is being finalized" }, { status: 409 });
      }
    }
    const keys = [
      manifest.original.key,
      manifest.optimized?.key,
      manifest.thumbnail?.key,
    ].filter((key): key is string => typeof key === "string");
    const referenced = await findReferencedStorageObjectKeys({
      bucketId: storage.bucket._id, keys,
    });
    if (referenced.size) {
      return Response.json({ error: "Upload is referenced by a stored object" }, { status: 409 });
    }
    const result = await storage.client.send(new DeleteObjectsCommand({
      Bucket: storage.bucket.b2BucketId,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }));
    if (result.Errors?.length) throw new Error("Blob deletion was incomplete");
    await PhotoUpload.updateOne(
      { _id: manifest._id, status: "aborting" },
      { $set: { status: "aborted" } },
    );
    return Response.json({ deleted: keys.length });
  } catch {
    return Response.json({ error: "Photo upload could not be aborted" }, { status: 500 });
  }
}
