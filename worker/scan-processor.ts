import { Worker, Job } from "bullmq";
import { getRedisClient } from "../lib/migrations/redis";
import { SCAN_QUEUE_NAME, fileQueue, scanQueue, ScanJobData, FILE_QUEUE_NAME } from "../lib/migrations/queues";
import MigrationJob, { MigrationStatus, ProviderType } from "../models/MigrationJob";
import MigrationFile, { MigrationFileStatus } from "../models/MigrationFile";
import { ProviderFactory } from "../lib/migrations/providers/ProviderFactory";
import { MongoClient } from "mongodb";
import mongoose from "mongoose";

const redis = getRedisClient();

export const createScanWorker = () => {
  return new Worker(
    SCAN_QUEUE_NAME,
    async (job: Job<ScanJobData>) => {
      const { migrationId, folderId, currentPath } = job.data;
      
      const migration = await MigrationJob.findById(migrationId);
      if (!migration || migration.status === MigrationStatus.CANCELLED) {
        return; // Job was cancelled or doesn't exist
      }

      // Update status if it's the first scan job
      if (migration.status === MigrationStatus.CREATED) {
        migration.status = MigrationStatus.SCANNING;
        await migration.save();
      }

      // 1. Fetch OAuth token for the user from Better Auth's DB collection
      const mongoClient = new MongoClient(process.env.MONGODB_URI!);
      await mongoClient.connect();
      const db = mongoClient.db();
      const accountCol = db.collection("account");
      const account = await accountCol.findOne({
        accountId: migration.providerAccountId,
      });
      await mongoClient.close();

      if (!account || !account.accessToken) {
        throw new Error("Provider account not found or access token missing");
      }

      const adapter = ProviderFactory.getAdapter(migration.provider as ProviderType, account.accessToken as string);

      // If this is the root scan job and sourceFolderId is an array/list, we can queue each one
      // But we structured scanJobData.folderId as a string. Let's handle it as a comma separated list.
      const itemsToScan = folderId.includes(',') ? folderId.split(',') : [folderId];

      for (const targetId of itemsToScan) {
        let baseFolderPath = currentPath;

        // If we are starting from a specific folder (not "root") and the currentPath is empty,
        // we must fetch the folder's actual name from Google Drive so the files are saved inside that folder
        // instead of being dumped into the root of the migration directory.
        // We also need to check if targetId is actually a FILE instead of a folder!
        let isRootTargetAFile = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let rootTargetFileMetadata: any = null;

        if (targetId !== "root" && !baseFolderPath) {
          try {
            const meta = await adapter.getFileMetadata(targetId);
            if (!meta.isFolder) {
              isRootTargetAFile = true;
              rootTargetFileMetadata = meta;
            } else {
              baseFolderPath = meta.name;
            }
          } catch (err) {
            console.warn(`Could not fetch metadata for target ${targetId}`, err);
          }
        }

        if (isRootTargetAFile && rootTargetFileMetadata) {
          // If the user selected a specific FILE from the UI to migrate, we don't scan it.
          // We just save it directly to the MigrationFile table.
          try {
            const migrationFile = new MigrationFile({
              migrationId: migration._id,
              providerFileId: rootTargetFileMetadata.id,
              fileName: rootTargetFileMetadata.name,
              providerFolderPath: currentPath, // The parent path passed into this job
              fileSize: rootTargetFileMetadata.size,
              mimeType: rootTargetFileMetadata.mimeType,
              status: MigrationFileStatus.PENDING,
            });
            await migrationFile.save();

            await MigrationJob.updateOne(
              { _id: migration._id },
              { $inc: { totalFiles: 1, totalBytes: rootTargetFileMetadata.size } }
            );

            await fileQueue.add("process-file", {
              migrationId: migration._id.toString(),
              migrationFileId: migrationFile._id.toString(),
            });
          } catch (error: unknown) {
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             if ((error as any).code !== 11000) console.error("Error saving single file:", error);
          }
          continue; // Skip the listFiles loop below for this target since it's just a file
        }

        let pageToken: string | undefined;
        do {
          const result = await adapter.listFiles(targetId, pageToken);
          pageToken = result.nextPageToken;

          for (const file of result.files) {
            if (file.isFolder) {
              // Queue another scan job for this folder
              await scanQueue.add("scan-folder", {
                migrationId,
                folderId: file.id,
                currentPath: baseFolderPath ? `${baseFolderPath}/${file.name}` : file.name,
              });
            } else {
              // Save to database as MigrationFile
              try {
                const migrationFile = new MigrationFile({
                  migrationId: migration._id,
                  providerFileId: file.id,
                  fileName: file.name,
                  providerFolderPath: baseFolderPath,
                  fileSize: file.size,
                  mimeType: file.mimeType,
                  status: MigrationFileStatus.PENDING,
                });
                await migrationFile.save();

                // Update totals
                await MigrationJob.updateOne(
                  { _id: migration._id },
                  { 
                    $inc: { totalFiles: 1, totalBytes: file.size } 
                  }
                );

                // Queue for download/upload
                await fileQueue.add("process-file", {
                  migrationId: migration._id.toString(),
                  migrationFileId: migrationFile._id.toString(),
                });
              } catch (error: unknown) {
                // Ignore duplicate keys (11000) in case worker crashed and retries
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                if ((error as any).code !== 11000) {
                  console.error("Error saving migration file:", error);
                }
              }
            }
          }
        } while (pageToken);
      }

      // 3. If this was the root folder scan, and we finished, we can mark it QUEUED
      // This is a naive approach; a better approach would be to check if there are any active scan jobs left.
      // But for simplicity, we let the file processor check if both queues are empty to mark COMPLETED.
    },
    { connection: redis as never, concurrency: 5 }
  );
};
