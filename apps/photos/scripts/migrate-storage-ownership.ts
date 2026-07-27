import {
  connectDatabase,
  getDatabase,
  getMongoose,
} from "@xenode/database";

async function migrateStorageOwnership() {
  await connectDatabase();
  const database = getDatabase();
  const storageObjectIds = await database
    .collection("photoAssets")
    .distinct("storageObjectId");
  const objectIds = storageObjectIds
    .filter(
      (value): value is string =>
        typeof value === "string" &&
        getMongoose().Types.ObjectId.isValid(value),
    )
    .map((value) => new (getMongoose().Types.ObjectId)(value));
  if (objectIds.length === 0) {
    console.log("[photos-storage] no Photos storage objects to migrate");
    return;
  }
  const result = await database.collection("storageobjects").updateMany(
    {
      _id: { $in: objectIds },
      productId: { $ne: "photos" },
    },
    {
      $set: {
        productId: "photos",
        updatedAt: new Date(),
      },
    },
  );
  console.log(
    `[photos-storage] matched=${result.matchedCount} migrated=${result.modifiedCount}`,
  );
}

migrateStorageOwnership()
  .catch((error) => {
    console.error("[photos-storage] migration failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getMongoose().disconnect();
  });
