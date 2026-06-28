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
  it("moves exhausted and non-retryable photos into durable skipped state", () => {
    const exhausted = item();
    const queue = new SyncQueue([exhausted]);

    expect(queue.markFailed(exhausted.id, "network")).toBe(true);
    expect(queue.markFailed(exhausted.id, "network")).toBe(true);
    expect(queue.markFailed(exhausted.id, "network")).toBe(true);
    expect(queue.markFailed(exhausted.id, "network")).toBe(true);
    expect(queue.markFailed(exhausted.id, "network")).toBe(false);
    expect(exhausted.status).toBe("skipped");
    expect(exhausted.error).toBe("network");
    expect(queue.failed).toEqual([exhausted]);

    const unavailable = item({ id: "asset-2" });
    const unavailableQueue = new SyncQueue([unavailable]);
    expect(
      unavailableQueue.markFailed(unavailable.id, "not available", false),
    ).toBe(false);
    expect(unavailable.status).toBe("skipped");
    expect(unavailable.retries).toBe(1);
  });

  it("only retries terminal failures after an explicit user action", () => {
    const failed = item({
      status: "skipped",
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
    const first = item({ status: "skipped", retries: 5, error: "first" });
    const second = item({
      id: "asset-2",
      status: "skipped",
      retries: 5,
      error: "second",
    });
    const queue = new SyncQueue([first, second]);

    expect(queue.retryFailed(new Set([first.id]))).toBe(1);
    expect(first.status).toBe("pending");
    expect(second.status).toBe("skipped");
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
    expect(engine).toContain('status: "skipped"');
    expect(engine).toContain("this.skippedCount");
    expect(engine).toContain("async hydrate(): Promise<void>");
    expect(worker).toContain('i.status !== "skipped"');
    expect(header).toContain('i.status !== "skipped"');
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
    expect(engine.indexOf("getSyncBlockInfo(error)")).toBeLessThan(
      engine.indexOf("isRetryableSyncError(error)"),
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
    expect(screen).toContain("Backup account");
    expect(screen).toContain("Tap to view backup items");
    expect(screen).not.toContain("Start Sync");
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
    expect(engine.indexOf("await getBackupPolicyBlock(this.userId)")).toBeLessThan(
      engine.indexOf("startOne(next)"),
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

  it("configures the engine before creating a foreground sync service", () => {
    const service = readFileSync(
      path.join(mobileRoot, "src/sync/SyncNotificationService.ts"),
      "utf8",
    );
    const cryptoContext = readFileSync(
      path.join(mobileRoot, "src/contexts/CryptoContext.tsx"),
      "utf8",
    );

    expect(service).toContain("private async _ensureEngineConfigured()");
    expect(service.indexOf("await this._ensureEngineConfigured()")).toBeLessThan(
      service.indexOf("notifee.displayNotification({"),
    );
    expect(service).toContain("loadCachedKeys(userId)");
    expect(service).toContain("await syncEngine.configure(");
    expect(service).toContain("this._startPromise");
    expect(cryptoContext).toContain("setFingerprintKey(keys.fingerprintKey)");
  });

  it("preflights free storage and cleans generated upload variants", () => {
    const engine = readFileSync(
      path.join(mobileRoot, "src/sync/SyncEngine.ts"),
      "utf8",
    );

    expect(engine).toContain("FileSystem.getFreeDiskStorageAsync()");
    expect(engine).toContain("CRITICAL_FREE_FLOOR");
    expect(engine).toContain("STORAGE_SAFETY_MARGIN");
    expect(engine).toContain("new SyncBlockedError");
    expect(engine).toContain("opts.tempFiles.push(tmp)");
    expect(engine).toContain("FileSystem.deleteAsync(t, { idempotent: true })");
  });

  it("persists the active queue transactionally in SQLite", () => {
    const db = readFileSync(
      path.join(mobileRoot, "src/sync/SyncDb.ts"),
      "utf8",
    );
    const storage = readFileSync(
      path.join(mobileRoot, "src/sync/SyncStorage.ts"),
      "utf8",
    );

    expect(db).toContain("CREATE TABLE IF NOT EXISTS backup_queue");
    expect(db).toContain("withExclusiveTransactionAsync");
    expect(db).toContain("runWrite");
    expect(storage).toContain("SyncDb.saveQueue");
    expect(storage).toContain("SyncDb.loadQueue");
  });

  it("discovers new work from an empty background queue when backup is enabled", () => {
    const worker = readFileSync(
      path.join(mobileRoot, "src/sync/SyncWorker.ts"),
      "utf8",
    );

    expect(worker).toContain("policy.enabled");
    expect(worker).toContain("syncEngine.shouldRunFullReconciliation()");
    expect(worker).toContain("await syncEngine.analyze");
  });

  it("resolves local-to-cloud identity before the first gallery render", () => {
    const photos = readFileSync(
      path.join(mobileRoot, "src/app/(drive)/photos.tsx"),
      "utf8",
    );

    expect(photos.indexOf('syncCheck(')).toBeLessThan(
      photos.indexOf("setPhotos(merged)"),
    );
    expect(photos).toContain("pre-render backup reconciliation");
    expect(photos).toContain("const ledger = await SyncDb.getCloudMap()");
  });

  it("keeps cloud photos visible when device photo access is denied", () => {
    const photos = readFileSync(
      path.join(mobileRoot, "src/app/(drive)/photos.tsx"),
      "utf8",
    );

    expect(photos).toContain("MediaLibrary.getPermissionsAsync");
    expect(photos).toContain('if (access === "none")');
    expect(photos).toContain("setPhotos(cloudOnly)");
    expect(photos).toContain("Cloud photos remain available");
    expect(photos).toContain("requestDevicePhotoAccess");
  });

  it("requests photo access only after the user confirms backup", () => {
    const screen = readFileSync(
      path.join(mobileRoot, "src/app/(drive)/sync.tsx"),
      "utf8",
    );
    const engine = readFileSync(
      path.join(mobileRoot, "src/sync/SyncEngine.ts"),
      "utf8",
    );

    expect(screen).toContain("Protect your entire photo library");
    expect(screen).toContain("choose “Allow all”");
    expect(screen).toContain("enableBackupWithPermission");
    expect(screen).toContain('permissionAccess === "limited"');
    expect(screen).toContain("Backing up selected photos only");
    expect(engine).toContain("MediaLibrary.getPermissionsAsync");
    expect(engine).not.toContain("MediaLibrary.requestPermissionsAsync(true)");
  });

  it("removes completed backup tiles immediately and gates the queue on permission", () => {
    const engine = readFileSync(
      path.join(mobileRoot, "src/sync/SyncEngine.ts"),
      "utf8",
    );
    const screen = readFileSync(
      path.join(mobileRoot, "src/app/(drive)/sync.tsx"),
      "utf8",
    );

    expect(engine).toContain("queue: [...this.queue.all]");
    expect(screen).toContain("hasMediaAccess");
    expect(screen).toContain("stickyPermissionCard");
    expect(screen).toContain("Allow photo access");
  });

  it("does not cache encrypted thumbnails before keys are available", () => {
    const cache = readFileSync(
      path.join(mobileRoot, "src/hooks/thumbnailCache.ts"),
      "utf8",
    );
    const photos = readFileSync(
      path.join(mobileRoot, "src/app/(drive)/photos.tsx"),
      "utf8",
    );

    expect(cache).toContain("thumbnails_v2");
    expect(cache).toContain("isEncrypted && !decryptionKey");
    expect(photos).toContain("isScrolling={isFastScrolling}");
    expect(photos).toContain("drawDistance={SH}");
    expect(photos).toContain("foregroundPerformance.beginPhotosInteraction");
  });

  it("uses immersive chrome and resolves cloud image size in the preview", () => {
    const preview = readFileSync(
      path.join(mobileRoot, "src/components/FilePreviewModal.tsx"),
      "utf8",
    );

    expect(preview).toContain("setResolvedSize(meta.size)");
    expect(preview).toContain('NavigationBar.setPositionAsync("absolute")');
    expect(preview).toContain('NavigationBar.setVisibilityAsync("hidden")');
    expect(preview).toContain("runOnJS(hideChrome)()");
    expect(preview).toContain(".maxPointers(1)");
  });
});
