import { validateStorageDeployment } from "@xenode/config/storage";
import { connectDatabase, getDatabase, getMongoose } from "@xenode/database";
import { ensureSystemWorkspaceBucketRecord, ensureWorkspaceBucket } from "../lib/storage/workspaceBucket";

async function seedStorageBuckets() {
  const configs = validateStorageDeployment();
  await connectDatabase();
  for (const name of ["buckets", "storageobjects", "uploadsessions", "photoUploads", "sharelinks", "directshares", "driveSyncTombstones"]) {
    if (await getDatabase().collection(name).countDocuments({}, { limit: 1 })) {
      throw new Error("Storage seed requires empty development storage collections; reset disposable data first");
    }
  }
  for (const region of configs.keys()) await ensureWorkspaceBucket("PERSONAL", region);
  for (const region of configs.keys()) {
    await ensureSystemWorkspaceBucketRecord("PERSONAL", region);
    console.log(`[storage-seed] verified and recorded ${region}`);
  }
}

seedStorageBuckets().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Storage seed failed");
  process.exitCode = 1;
}).finally(() => getMongoose().disconnect());
