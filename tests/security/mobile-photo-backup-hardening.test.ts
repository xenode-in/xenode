import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SyncQueue } from "../../../xenode-expo/src/sync/SyncQueue";
import {
  getSyncBlockReason,
  isRetryableSyncError,
} from "../../../xenode-expo/src/sync/errorPolicy";
import type { SyncItem } from "../../../xenode-expo/src/sync/types";

const mobileRoot = path.resolve(__dirname, "../../../xenode-expo");

function item(overrides: Partial<SyncItem> = {}): SyncItem {
  return {
    id: "asset-1",
    localUri: "file:///photo.jpg",
    filename: "photo.jpg",
    creationTime: 1,
    width: 100,
    height: 100,
    fileSize: 100,
    mimeType: "image/jpeg",
    status: "pending",
    retries: 0,
    ...overrides,
  };
}

describe("Android photo backup production hardening", () => {
  it("keeps exhausted and non-retryable failures durable", () => {
    const exhausted = item();
    const queue = new SyncQueue([exhausted]);

    expect(queue.markFailed(exhausted.id, "network")).toBe(true);
    expect(queue.markFailed(exhausted.id, "network")).toBe(true);
    expect(queue.markFailed(exhausted.id, "network")).toBe(true);
    expect(queue.markFailed(exhausted.id, "network")).toBe(true);
    expect(queue.markFailed(exhausted.id, "network")).toBe(false);
    expect(exhausted.status).toBe("failed");
    expect(exhausted.error).toBe("network");
    expect(queue.failed).toEqual([exhausted]);

    const unavailable = item({ id: "asset-2" });
    const unavailableQueue = new SyncQueue([unavailable]);
    expect(
      unavailableQueue.markFailed(unavailable.id, "not available", false),
    ).toBe(false);
    expect(unavailable.status).toBe("failed");
    expect(unavailable.retries).toBe(1);
  });

  it("only retries terminal failures after an explicit user action", () => {
    const failed = item({
      status: "failed",
      retries: 5,
      error: "quota",
      uploadProgress: 0.8,
    });
    const pending = item({ id: "asset-2" });
    const queue = new SyncQueue([failed, pending]);

    expect(queue.nextPending()).toBe(pending);
    expect(queue.retryFailed()).toBe(1);
    expect(failed).toMatchObject({
      status: "pending",
      retries: 0,
      uploadProgress: 0,
      uploadStep: "Waiting to retry",
    });
    expect(failed.error).toBeUndefined();
  });

  it("supports targeted retry and explicit removal of terminal failures", () => {
    const first = item({ status: "failed", retries: 5, error: "first" });
    const second = item({
      id: "asset-2",
      status: "failed",
      retries: 5,
      error: "second",
    });
    const queue = new SyncQueue([first, second]);

    expect(queue.retryFailed(new Set([first.id]))).toBe(1);
    expect(first.status).toBe("pending");
    expect(second.status).toBe("failed");
    expect(queue.dismissFailed(second.id)).toBe(true);
    expect(queue.getItem(second.id)).toBeUndefined();
  });

  it("prevents unavailable media from returning as a successful upload", () => {
    const engine = readFileSync(
      path.join(mobileRoot, "src/sync/SyncEngine.ts"),
      "utf8",
    );
    const worker = readFileSync(
      path.join(mobileRoot, "src/sync/SyncWorker.ts"),
      "utf8",
    );
    const header = readFileSync(
      path.join(mobileRoot, "src/components/GlobalHeader.tsx"),
      "utf8",
    );

    expect(engine).toContain("throw new NonRetryableSyncError");
    expect(engine).not.toContain(
      'this.queue.updateItem(item.id, { status: "skipped" })',
    );
    expect(engine).toContain('item.status !== "failed"');
    expect(engine).toContain("async hydrate(): Promise<void>");
    expect(worker).toContain('i.status !== "failed"');
    expect(header).toContain('i.status !== "failed"');
  });

  it("retries transient failures but stops on permanent API rejections", () => {
    expect(isRetryableSyncError(new TypeError("offline"))).toBe(true);
    expect(isRetryableSyncError({ statusCode: 500 })).toBe(true);
    expect(isRetryableSyncError({ statusCode: 408 })).toBe(true);
    expect(isRetryableSyncError({ statusCode: 429 })).toBe(true);

    expect(isRetryableSyncError({ statusCode: 402 })).toBe(false);
    expect(isRetryableSyncError({ statusCode: 403 })).toBe(false);
    expect(isRetryableSyncError({ retryable: false, statusCode: 500 })).toBe(
      false,
    );
  });

  it("blocks the queue for account-wide API recovery conditions", () => {
    expect(getSyncBlockReason({ statusCode: 401 })).toContain("session expired");
    expect(getSyncBlockReason({ statusCode: 402 })).toContain("quota");
    expect(getSyncBlockReason({ statusCode: 403 })).toContain("access");
    expect(getSyncBlockReason({ statusCode: 429 })).toBeNull();
    expect(getSyncBlockReason({ statusCode: 500 })).toBeNull();
    expect(
      getSyncBlockReason({ syncBlockReason: "Free device storage" }),
    ).toBe("Free device storage");

    const engine = readFileSync(
      path.join(mobileRoot, "src/sync/SyncEngine.ts"),
      "utf8",
    );
    expect(engine.indexOf("getSyncBlockReason(error)")).toBeLessThan(
      engine.indexOf("this.queue.markFailed"),
    );
  });

  it("does not silently swallow critical queue persistence failures", () => {
    const storage = readFileSync(
      path.join(mobileRoot, "src/sync/SyncStorage.ts"),
      "utf8",
    );
    const saveQueue = storage.slice(
      storage.indexOf("static async saveQueue"),
      storage.indexOf("static async loadQueue"),
    );

    expect(saveQueue).toContain("throw e");
  });

  it("round-trips a 100k-item queue within a bounded serialized payload", () => {
    const queue = Array.from({ length: 100_000 }, (_, index) =>
      item({
        id: `asset-${index}`,
        localUri: `file:///photo-${index}.jpg`,
        filename: `photo-${index}.jpg`,
        creationTime: index,
      }),
    );

    const serialized = JSON.stringify(queue);
    const restored = JSON.parse(serialized) as SyncItem[];

    expect(restored).toHaveLength(queue.length);
    expect(restored[99_999].id).toBe("asset-99999");
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThan(30 * 1024 * 1024);
  });

  it("retries failed legacy sync-state migration on a later process launch", () => {
    const db = readFileSync(
      path.join(mobileRoot, "src/sync/SyncDb.ts"),
      "utf8",
    );
    const failureHandler = db.slice(
      db.indexOf("migrateFromAsyncStorage failed"),
      db.indexOf("export const SyncDb"),
    );

    expect(failureHandler).not.toContain(
      'AsyncStorage.setItem(MIGRATION_FLAG_KEY, "1")',
    );
  });

  it("persists account-scoped last-success backup health", () => {
    const engine = readFileSync(
      path.join(mobileRoot, "src/sync/SyncEngine.ts"),
      "utf8",
    );
    const storage = readFileSync(
      path.join(mobileRoot, "src/sync/SyncStorage.ts"),
      "utf8",
    );
    const screen = readFileSync(
      path.join(mobileRoot, "src/app/(drive)/sync.tsx"),
      "utf8",
    );

    expect(engine).toContain("await SyncStorage.saveBackupHealth");
    expect(engine).toContain("SyncStorage.loadBackupHealth");
    expect(storage).toContain("isSyncConfigOwner(health.userId, userId)");
    expect(storage).toContain("BACKUP_HEALTH_KEY");
    expect(screen).toContain("Last successful backup:");
    expect(screen).toContain("syncState.failedCount");
  });

  it("enforces account-scoped Wi-Fi policy without consuming retries", () => {
    const policy = readFileSync(
      path.join(mobileRoot, "src/sync/BackupPolicy.ts"),
      "utf8",
    );
    const storage = readFileSync(
      path.join(mobileRoot, "src/sync/SyncStorage.ts"),
      "utf8",
    );
    const engine = readFileSync(
      path.join(mobileRoot, "src/sync/SyncEngine.ts"),
      "utf8",
    );

    expect(policy).toContain("NetworkStateType.WIFI");
    expect(policy).toContain("NetworkStateType.ETHERNET");
    expect(storage).toContain("isSyncConfigOwner(policy.userId, userId)");
    expect(storage).toContain("BACKUP_POLICY_KEY");
    expect(engine).toContain('this.setStatus("blocked")');
    expect(engine.indexOf('this.setStatus("blocked")')).toBeLessThan(
      engine.indexOf("this.queue.markFailed"),
    );
  });

  it("surfaces and automatically rechecks blocked backup conditions", () => {
    const header = readFileSync(
      path.join(mobileRoot, "src/components/GlobalHeader.tsx"),
      "utf8",
    );
    const modal = readFileSync(
      path.join(mobileRoot, "src/components/sync/PreSyncModal.tsx"),
      "utf8",
    );
    const screen = readFileSync(
      path.join(mobileRoot, "src/app/(drive)/sync.tsx"),
      "utf8",
    );

    expect(header).toContain("Network.addNetworkStateListener");
    expect(header).toContain('syncEngine.status !== "blocked"');
    expect(modal).toContain("Backup waiting");
    expect(modal).toContain("blockedReason");
    expect(screen).toContain("Back up on Wi-Fi only");
  });

  it("stops the foreground service when backup becomes blocked or errors", () => {
    const service = readFileSync(
      path.join(mobileRoot, "src/sync/SyncNotificationService.ts"),
      "utf8",
    );

    expect(service).toContain("this._serviceRunning = true");
    expect(service).toContain('status === "error"');
    expect(service).toContain('status === "blocked"');
  });

  it("preflights free storage and cleans generated upload variants", () => {
    const engine = readFileSync(
      path.join(mobileRoot, "src/sync/SyncEngine.ts"),
      "utf8",
    );

    expect(engine).toContain("FileSystem.getFreeDiskStorageAsync()");
    expect(engine).toContain("MIN_FREE_STORAGE_RESERVE");
    expect(engine).toContain("new SyncBlockedError");
    expect(engine).toContain("tempFiles.push(thumbResult.uri, optResult.uri)");
    expect(engine).toContain("FileSystem.deleteAsync(t, { idempotent: true })");
  });
});
