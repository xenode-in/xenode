import { Queue } from "bullmq";
import { getRedisClient } from "./redis";

// Queues
export const SCAN_QUEUE_NAME = "migration-scan-queue";
export const FILE_QUEUE_NAME = "migration-file-queue";

const connection = getRedisClient();

export const scanQueue = new Queue(SCAN_QUEUE_NAME, { 
  connection: connection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000, // 5s, 25s, 125s
    },
    removeOnComplete: 100,
    removeOnFail: 1000,
  }
});

export const fileQueue = new Queue(FILE_QUEUE_NAME, { 
  connection: connection as any,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 60000, // 1m, 2m, 4m, 8m, 16m
    },
    removeOnComplete: 100,
    removeOnFail: 1000,
  }
});

export interface ScanJobData {
  migrationId: string;
  folderId: string;
  currentPath: string;
}

export interface FileJobData {
  migrationId: string;
  migrationFileId: string;
}
