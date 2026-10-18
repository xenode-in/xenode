import type { HandoffBinding } from "./index";

/** Serialize interactive completion so messages and repeated clicks cannot race. */
export function createHandoffAttempt() {
  let current: AbortController | null = null;
  return {
    get active() { return current !== null; },
    cancel() { current?.abort(); current = null; },
    start(consume: (signal: AbortSignal) => Promise<unknown>, onFailure: (error: unknown) => void) {
      if (current) return;
      const controller = new AbortController();
      current = controller;
      void Promise.resolve().then(() => consume(controller.signal)).catch((error: unknown) => {
        if (!controller.signal.aborted) onFailure(error);
      }).finally(() => {
        if (current === controller) current = null;
      });
    },
  };
}

/**
 * An isolated product cannot rely on a cross-origin popup's window.opener.
 * Only the original product tab polls its authenticated, one-use consumer.
 * 410 deliberately does not distinguish pending, expired or mismatched grants.
 */
export async function fetchHandoffResponse(
  binding: HandoffBinding,
  options: { signal?: AbortSignal; waitForCreation?: boolean } = {},
): Promise<Response> {
  const signal = options.waitForCreation
    ? AbortSignal.any([
        ...(options.signal ? [options.signal] : []),
        AbortSignal.timeout(120_000),
      ])
    : options.signal;
  while (true) {
    signal?.throwIfAborted();
    const response = await fetch(
      `/api/key-handoffs/${encodeURIComponent(binding.transactionId)}/consume`,
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(binding),
        signal,
      },
    );
    signal?.throwIfAborted();
    if (!options.waitForCreation || response.status !== 410) return response;
    await response.body?.cancel();
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, 1_000);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }
}
