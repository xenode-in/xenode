import { getApiLogModel } from "@/models/ApiLog";

export interface LogPayload {
  userId: string | null;
  method: string;
  endpoint: string;
  statusCode: number;
  durationMs: number;
  ip: string;
  userAgent: string;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
}

function sanitizeEndpoint(url: string | URL): string {
  const path = typeof url === "string" ? url : url.pathname;
  return path
    .replace(/\/[a-fA-F0-9]{24}\b/g, "/[id]") // Replace MongoDB ObjectIDs
    .replace(/\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, "/[uuid]"); // Replace UUIDs
}

/**
 * Fire-and-forget API request logger.
 * Writes to the separate Xenode-logs MongoDB instance.
 * Must never block the API response or throw.
 */
export function logRequest(payload: LogPayload): void {
  void (async () => {
    try {
      const ApiLog = await getApiLogModel();
      await ApiLog.create({
        ...payload,
        endpoint: sanitizeEndpoint(payload.endpoint),
      });
    } catch {
      // intentionally swallowed — logging must never break production
    }
  })();
}
