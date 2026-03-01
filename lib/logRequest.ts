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

/**
 * Fire-and-forget API request logger.
 * Writes to the separate xnode-logs MongoDB instance.
 * Never awaited — never blocks the API response.
 */
export function logRequest(payload: LogPayload): void {
  void (async () => {
    try {
      const ApiLog = await getApiLogModel();
      await ApiLog.create(payload);
    } catch {
      // Logging must never break production
    }
  })();
}
