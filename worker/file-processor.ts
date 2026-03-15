import { Worker, Job } from "bullmq";
import { getRedisClient } from "../lib/migrations/redis";
import { FILE_QUEUE_NAME, FileJobData } from "../lib/migrations/queues";
import MigrationJob, { MigrationStatus } from "../models/MigrationJob";
import MigrationFile, { MigrationFileStatus } from "../models/MigrationFile";
import { ProviderFactory } from "../lib/migrations/providers/ProviderFactory";
import { ConcurrencyLock } from "./concurrency-lock";
import { uploadStreamToB2 } from "../lib/migrations/utils/stream-upload";
import { MongoClient, ObjectId } from "mongodb";
import mongoose from "mongoose";
import Bucket from "../models/Bucket";
import StorageObject from "../models/StorageObject";
import { ProviderType } from "../models/MigrationJob";
import { createEncryptedStream } from "../lib/crypto/serverEncryption";
import UserKeyVault from "../models/UserKeyVault";
import * as crypto from "crypto";
import { Readable } from "stream";

const redis = getRedisClient();
const WORKER_ID = `worker-${Math.random().toString(36).substr(2, 9)}`;

export const createFileWorker = () => {
  return new Worker(
    FILE_QUEUE_NAME,
    async (job: Job<FileJobData>) => {
      const { migrationId, migrationFileId } = job.data;

      const migration = await MigrationJob.findById(migrationId);
      if (!migration || migration.status === MigrationStatus.CANCELLED) {
        return; // Job cancelled
      }

      const migrationFile = await MigrationFile.findById(migrationFileId);
      if (
        !migrationFile ||
        migrationFile.status === MigrationFileStatus.COMPLETED
      ) {
        return; // Already done
      }

      // 1. Acquire Concurrency Lock per user
      const lock = new ConcurrencyLock(migration.userId, WORKER_ID, 60);
      const acquired = await lock.acquire();
      if (!acquired) {
        // Another worker is processing this user's migration
        // Move to delayed for 30s so we can grab a different job
        await job.moveToDelayed(Date.now() + 30000, job.token!);
        return;
      }

      let mongoClient: MongoClient | null = null;
      try {
        migrationFile.status = MigrationFileStatus.DOWNLOADING;
        await migrationFile.save();

        // 2. Setup Provider
        mongoClient = new MongoClient(process.env.MONGODB_URI!);
        await mongoClient.connect();
        
        const db = mongoClient.db();
        const accountCol = db.collection("account");
        const account = await accountCol.findOne({
          accountId: migration.providerAccountId,
        });

        if (!account || !account.accessToken) {
          throw new Error("Provider account not found or access token missing");
        }

        const adapter = ProviderFactory.getAdapter(
          migration.provider as ProviderType,
          account.accessToken as string,
        );

        // 3. Start Streaming Download
        const readStream = await adapter.downloadStream(
          migrationFile.providerFileId,
          migrationFile.mimeType,
        );

        // 4. Update status to Uploading
        migrationFile.status = MigrationFileStatus.UPLOADING;
        await migrationFile.save();

        // 5. Construct Key for Xenode
        const bucket = await Bucket.findById(migration.destinationBucketId);
        if (!bucket) throw new Error("Destination bucket not found");

        // 5. Construct Keys for Xenode
        // We determine the logical relative path (e.g. "migrations/Folder/File.pdf")
        let logicalPath = migrationFile.fileName;
        if (migrationFile.providerFolderPath) {
          const cleanPath = migrationFile.providerFolderPath.replace(
            /^\/|\/$/g,
            "",
          );
          logicalPath = `${cleanPath}/${logicalPath}`;
        }

        // Add the migration's root destination path (e.g. "users/[id]/migrations/")
        if (migration.destinationPath) {
          logicalPath = `${migration.destinationPath}${logicalPath}`;
        }

        // Clean any double-prefixing just in case
        let cleanLogicalPath = logicalPath;
        const userPrefix = `users/${migration.userId}/`;
        if (cleanLogicalPath.startsWith(userPrefix)) {
          cleanLogicalPath = cleanLogicalPath.substring(userPrefix.length);
        }
        const fullLogicalPath = `${userPrefix}${cleanLogicalPath}`;

        // The S3 Object Key and MongoDB Key MUST contain the folder paths so the UI renders the folder tree!
        // We bypass the strict opaque-key (GAP-4) rule for migrations specifically because
        // the UI requires slashes in the 'key' to generate nested folder views.
        const s3ObjectKey = fullLogicalPath;

        // 6. Check for Encryption
        const userCol = db.collection("user");
        const userPrefs = await userCol.findOne({ _id: new ObjectId(migration.userId) });
        const encryptByDefault = userPrefs?.encryptByDefault === true;
        
        let finalStream: Readable = readStream;
        let encryptedDEK: string | undefined;
        let iv: string | undefined;
        let encryptedName: string | undefined;
        let isEncrypted = false;

        if (encryptByDefault) {
          const vault = await UserKeyVault.findOne({ userId: migration.userId });
          if (vault && vault.publicKey) {
            isEncrypted = true;
            const enc = await createEncryptedStream(
              migration.userId,
              vault.publicKey,
              migrationFile.fileName // We ONLY encrypt the base filename here, because the frontend expects it to be just "File.jpg", while the MongoDB key handles the folder hierarchy
            );
            finalStream = readStream.pipe(enc.cipherStream);
            encryptedDEK = enc.encryptedDEK;
            iv = enc.iv;
            encryptedName = enc.encryptedName;
          }
        } 

        // 7. Stream directly to S3 (No Memory Overhead) using the Logical Key
        let lastLoaded = 0;
        const uploadResult = await uploadStreamToB2(
          "xenode-drive-storage", // Use b2BucketId if available
          s3ObjectKey,
          finalStream,
          migrationFile.mimeType,
          async (progress) => {
            if (progress.loaded) {
              const diff = progress.loaded - lastLoaded;
              lastLoaded = progress.loaded;
              // Update real-time progress in Redis
              await redis.hincrby(
                `migration:progress:${migrationId}`,
                "bytes",
                diff,
              );
            }
          },
        );

        // 8. Save to Xenode DB
        const storageObj = new StorageObject({
          bucketId: bucket._id,
          userId: migration.userId,
          key: s3ObjectKey, // This allows the dashboard to render the folder hierarchy
          size: isEncrypted
            ? migrationFile.fileSize + 16
            : migrationFile.fileSize, // WebCrypto AES-GCM appends 16-byte auth tag
          contentType: migrationFile.mimeType,
          b2FileId: uploadResult.b2FileId, // Native VersionId from Backblaze
          isEncrypted,
          encryptedDEK,
          iv,
          encryptedName,
        });
        await storageObj.save();

        // Update bucket stats
        await Bucket.updateOne(
          { _id: bucket._id },
          { $inc: { objectCount: 1, totalSizeBytes: migrationFile.fileSize } },
        );

        // 8. Mark Complete
        migrationFile.status = MigrationFileStatus.COMPLETED;
        migrationFile.uploadedFileId = storageObj._id;
        await migrationFile.save();

        await MigrationJob.updateOne(
          { _id: migration._id },
          {
            $inc: { processedFiles: 1, migratedBytes: migrationFile.fileSize },
          },
        );

        await mongoClient.close();
      } catch (error: unknown) {
        console.error(`Error processing file ${migrationFileId}:`, error);

        try {
           // Attempt to safely close if it was opened
           const mClient = new MongoClient(process.env.MONGODB_URI!);
           // Wait, we don't have access to mongoClient here. Let's restructure to guarantee close.
        } catch(e) {}

        migrationFile.retryCount += 1;
        if (migrationFile.retryCount >= 5) {
          migrationFile.status = MigrationFileStatus.FAILED;
          migrationFile.errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          await MigrationJob.updateOne(
            { _id: migration._id },
            { $inc: { failedFiles: 1 } },
          );
        } else {
          migrationFile.status = MigrationFileStatus.PENDING;
          throw error; // Let BullMQ retry
        }
        await migrationFile.save();
      } finally {
        if (mongoClient) {
          try {
            await mongoClient.close();
          } catch (e) {
            console.error("Failed to close mongo client:", e);
          }
        }
        await lock.release();
      }
    },
    { connection: redis as never, concurrency: 5 },
  );
};
