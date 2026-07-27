import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getDatabase, getMongoose } from "@xenode/database";
import { getPhotosProductSession } from "@/lib/session";
import { getPhotosStorageContext } from "@/lib/storage-server";

export async function POST(request: Request) {
  const session = await getPhotosProductSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    bucketId?: unknown;
    objectKeys?: unknown;
  } | null;
  const objectKeys = Array.isArray(body?.objectKeys)
    ? [...new Set(body.objectKeys)]
    : [];
  if (
    typeof body?.bucketId !== "string" ||
    !getMongoose().Types.ObjectId.isValid(body.bucketId) ||
    objectKeys.length === 0 ||
    objectKeys.length > 3 ||
    !objectKeys.every(
      (key): key is string =>
        typeof key === "string" &&
        new RegExp(
          `^users/${escapeRegex(session.accountId)}/[a-f0-9]{32}$`,
          "u",
        ).test(key),
    )
  ) {
    return Response.json({ error: "Invalid upload cleanup" }, { status: 400 });
  }

  try {
    const storage = await getPhotosStorageContext(session.accountId);
    if (storage.bucket._id.toString() !== body.bucketId) {
      return Response.json({ error: "Invalid regional bucket" }, { status: 403 });
    }
    const referenced = await getDatabase()
      .collection("storageobjects")
      .find({
        productId: "photos",
        createdByAccountId: session.accountId,
        $or: [
          { key: { $in: objectKeys } },
          { optimizedKey: { $in: objectKeys } },
          { thumbnail: { $in: objectKeys } },
        ],
      })
      .project({ key: 1, optimizedKey: 1, thumbnail: 1 })
      .toArray();
    const protectedKeys = new Set(
      referenced.flatMap((object) =>
        [object.key, object.optimizedKey, object.thumbnail].filter(
          (key): key is string => typeof key === "string",
        ),
      ),
    );
    const disposableKeys = objectKeys.filter((key) => !protectedKeys.has(key));
    if (disposableKeys.length > 0) {
      await storage.client.send(
        new DeleteObjectsCommand({
          Bucket: storage.bucket.b2BucketId,
          Delete: {
            Objects: disposableKeys.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    }
    return Response.json({ deleted: disposableKeys.length });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not clean up upload",
      },
      { status: 500 },
    );
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
