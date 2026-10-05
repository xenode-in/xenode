import { getStorageUsageReconciliation } from "@xenode/database";

/**
 * Usage byte counters are written only by the shared storage transactions in
 * `@xenode/database` (upload/revision finalization, version cleanup and Bin
 * purge), and plan state only by `syncUserSubscriptionState`. This module
 * reads; it never mutates Usage.
 */

/**
 * Recompute a personal Space's retained ciphertext bytes from its metadata, using the same
 * definition as finalization and purge: current content plus derivatives, plus
 * retained versions that do not share current content, across both products.
 * Read-only — a reconciliation report must never overwrite the counters that
 * concurrent transactions maintain.
 */
export async function computePersonalUsageTotals(userId: string): Promise<{
  totalStorageBytes: number;
  totalObjects: number;
}> {
  const report = await getStorageUsageReconciliation({ type: "personal", id: userId });
  if (!report.computed) throw new Error("Storage usage cannot be computed from invalid or incomplete data");
  return report.computed;
}

export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export function bytesToGB(bytes: number): number {
  return Number((bytes / (1024 * 1024 * 1024)).toFixed(2));
}
