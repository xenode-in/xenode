import mongoose from "mongoose";
import {
  DEFAULT_STORAGE_REGION,
  STORAGE_REGIONS,
  isStorageRegion,
  resolveRegionBucketConfig,
  type StorageRegion,
} from "@xenode/config/storage";
import dbConnect from "../lib/mongodb";

type BucketIndex = {
  name: string;
  key: Record<string, number>;
  unique?: boolean;
};

function isLegacySystemKeyIndex(index: BucketIndex): boolean {
  return (
    index.unique === true &&
    Object.keys(index.key).length === 1 &&
    index.key.systemKey === 1
  );
}

async function migrateRegionalBuckets(): Promise<void> {
  await dbConnect();
  const buckets = mongoose.connection.collection("buckets");

  const configs = new Map(
    STORAGE_REGIONS.map((storageRegion) => [
      storageRegion,
      resolveRegionBucketConfig(storageRegion),
    ]),
  );

  const legacyRows = await buckets
    .find({
      systemKey: "drive",
      storageRegion: { $exists: false },
    })
    .toArray();

  for (const row of legacyRows) {
    const inferredRegion = STORAGE_REGIONS.find(
      (storageRegion) =>
        configs.get(storageRegion)?.bucketName === row.b2BucketId,
    );
    if (!inferredRegion) {
      throw new Error(
        `Cannot infer storageRegion for legacy bucket ${String(row._id)} (${String(row.b2BucketId)})`,
      );
    }
    const config = configs.get(inferredRegion)!;
    await buckets.updateOne(
      { _id: row._id },
      {
        $set: {
          storageRegion: inferredRegion,
          name: config.bucketName,
          b2BucketId: config.bucketName,
          region: config.region,
          updatedAt: new Date(),
        },
      },
    );
  }

  const indexes = (await buckets.indexes()) as BucketIndex[];
  for (const index of indexes) {
    if (isLegacySystemKeyIndex(index)) {
      await buckets.dropIndex(index.name);
      console.log(`[regional-buckets] dropped legacy index ${index.name}`);
    }
  }

  await buckets.createIndex(
    { systemKey: 1, storageRegion: 1 },
    { unique: true, name: "systemKey_1_storageRegion_1" },
  );

  for (const storageRegion of STORAGE_REGIONS) {
    const config = configs.get(storageRegion)!;
    await buckets.updateOne(
      { systemKey: "drive", storageRegion },
      {
        $set: {
          name: config.bucketName,
          b2BucketId: config.bucketName,
          region: config.region,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          systemKey: "drive",
          storageRegion,
          objectCount: 0,
          totalSizeBytes: 0,
          createdAt: new Date(),
        },
        $unset: {
          userId: "",
          ownerScope: "",
          orgId: "",
          teamId: "",
          createdBy: "",
        },
      },
      { upsert: true },
    );
    console.log(
      `[regional-buckets] ensured ${storageRegion} -> ${config.bucketName}`,
    );
  }

  const records = await buckets
    .find(
      { systemKey: "drive" },
      {
        projection: {
          _id: 0,
          storageRegion: 1,
          name: 1,
          b2BucketId: 1,
          region: 1,
        },
      },
    )
    .sort({ storageRegion: 1 })
    .toArray();

  if (records.length !== STORAGE_REGIONS.length) {
    throw new Error(
      `Expected ${STORAGE_REGIONS.length} regional bucket records, found ${records.length}`,
    );
  }

  console.table(records);

  const bucketByRegion = new Map<StorageRegion, mongoose.Types.ObjectId>();
  for (const storageRegion of STORAGE_REGIONS) {
    const record = await buckets.findOne({
      systemKey: "drive",
      storageRegion,
    });
    if (!record) throw new Error(`Missing ${storageRegion} bucket after migration`);
    bucketByRegion.set(storageRegion, record._id);
  }

  const spaces = mongoose.connection.collection("spaces");
  const profiles = mongoose.connection.collection("accountProfiles");
  const orgUsages = mongoose.connection.collection("orgusages");
  const storageObjects = mongoose.connection.collection("storageobjects");

  let reassignedObjects = 0;
  const spaceIds = await storageObjects.distinct("spaceId");
  for (const spaceId of spaceIds) {
    const space = await spaces.findOne({ _id: spaceId });
    let storageRegion: StorageRegion = DEFAULT_STORAGE_REGION;

    if (space?.type === "personal") {
      const profile = await profiles.findOne({
        accountId: space.ownerAccountId,
      });
      if (isStorageRegion(profile?.storageRegion)) {
        storageRegion = profile.storageRegion;
      }
    } else if (
      (space?.type === "organization" || space?.type === "team") &&
      typeof space.organizationId === "string"
    ) {
      const usage = await orgUsages.findOne({
        orgId: space.organizationId,
      });
      if (isStorageRegion(usage?.storageRegion)) {
        storageRegion = usage.storageRegion;
      }
    } else if (
      typeof spaceId === "string" &&
      spaceId.startsWith("space_personal_")
    ) {
      const accountId = decodeURIComponent(
        spaceId.slice("space_personal_".length),
      );
      const profile = await profiles.findOne({ accountId });
      if (isStorageRegion(profile?.storageRegion)) {
        storageRegion = profile.storageRegion;
      }
    }

    const result = await storageObjects.updateMany(
      {
        spaceId,
        bucketId: { $ne: bucketByRegion.get(storageRegion) },
      },
      {
        $set: {
          bucketId: bucketByRegion.get(storageRegion),
          updatedAt: new Date(),
        },
      },
    );
    reassignedObjects += result.modifiedCount;
  }

  // Share records cache the object's bucket id. Keep those references aligned
  // with the canonical StorageObject after its regional backfill.
  let reassignedShares = 0;
  const shareLinks = mongoose.connection.collection("sharelinks");
  const directShares = mongoose.connection.collection("directshares");
  let shareOps: Array<{
    updateMany: {
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
    };
  }> = [];
  let directShareOps = [...shareOps];

  for await (const object of storageObjects.find(
    {},
    { projection: { _id: 1, bucketId: 1 } },
  )) {
    shareOps.push({
      updateMany: {
        filter: { objectId: object._id, bucketId: { $ne: object.bucketId } },
        update: { $set: { bucketId: object.bucketId, updatedAt: new Date() } },
      },
    });
    directShareOps.push({
      updateMany: {
        filter: { objectId: object._id, bucketId: { $ne: object.bucketId } },
        update: { $set: { bucketId: object.bucketId, updatedAt: new Date() } },
      },
    });

    if (shareOps.length >= 1000) {
      const [publicResult, directResult] = await Promise.all([
        shareLinks.bulkWrite(shareOps, { ordered: false }),
        directShares.bulkWrite(directShareOps, { ordered: false }),
      ]);
      reassignedShares +=
        publicResult.modifiedCount + directResult.modifiedCount;
      shareOps = [];
      directShareOps = [];
    }
  }
  if (shareOps.length > 0) {
    const [publicResult, directResult] = await Promise.all([
      shareLinks.bulkWrite(shareOps, { ordered: false }),
      directShares.bulkWrite(directShareOps, { ordered: false }),
    ]);
    reassignedShares += publicResult.modifiedCount + directResult.modifiedCount;
  }

  for (const bucketId of bucketByRegion.values()) {
    const [stats] = await storageObjects
      .aggregate<{ objectCount: number; totalSizeBytes: number }>([
        { $match: { bucketId } },
        {
          $group: {
            _id: null,
            objectCount: { $sum: 1 },
            totalSizeBytes: { $sum: "$size" },
          },
        },
      ])
      .toArray();
    await buckets.updateOne(
      { _id: bucketId },
      {
        $set: {
          objectCount: stats?.objectCount ?? 0,
          totalSizeBytes: stats?.totalSizeBytes ?? 0,
          updatedAt: new Date(),
        },
      },
    );
  }

  console.log(
    `[regional-buckets] reassigned objects=${reassignedObjects} shares=${reassignedShares}`,
  );
}

migrateRegionalBuckets()
  .catch((error) => {
    console.error("[regional-buckets] migration failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
