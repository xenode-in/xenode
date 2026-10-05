import type { UploadJournalScope } from "./journal";

/** Captured scope wins over caller headers; stale responses cannot escape. */
export function createScopedUploadRequest(options: {
  scope: UploadJournalScope;
  signal: AbortSignal;
  isActive(): boolean;
  waitWhilePaused?(): Promise<void>;
  fetch?: typeof fetch;
}) {
  const spaceId = options.scope.spaceId;
  const prefix = options.scope.productId === "drive" ? "/api/objects/" : "/api/photos/uploads/";
  const check = () => {
    if (options.signal.aborted || !options.isActive()) throw new Error("Upload encryption context changed");
  };
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    check();
    if (!path.startsWith(prefix) || path.includes("/../")) throw new Error("Invalid upload API path");
    await options.waitWhilePaused?.();
    check();
    const headers = new Headers(init.headers);
    headers.set("x-xenode-space-id", spaceId);
    const response = await (options.fetch ?? fetch)(path, { ...init, headers, credentials: "include",
      cache: "no-store", signal: options.signal });
    check();
    return response;
  };
}
