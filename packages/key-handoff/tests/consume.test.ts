import { afterEach, expect, it, vi } from "vitest";
import { createHandoffAttempt, fetchHandoffResponse, type HandoffBinding } from "../src";

const binding: HandoffBinding = {
  transactionId: "synthetic-transaction", accountId: "account", clientId: "xenode-drive-web",
  productId: "drive", spaceId: "space", destinationOrigin: "https://drive.example.test",
  state: "bound-state", nonce: "bound-nonce",
};
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("serializes repeated interactive clicks and suppresses cancelled failures", async () => {
  const attempt = createHandoffAttempt();
  let fail!: (error: unknown) => void;
  const consume = vi.fn((_signal: AbortSignal) => new Promise((_resolve, reject) => { fail = reject; }));
  const onFailure = vi.fn();
  attempt.start(consume, onFailure);
  attempt.start(consume, onFailure);
  await Promise.resolve();
  expect(consume).toHaveBeenCalledTimes(1);
  expect(attempt.active).toBe(true);
  attempt.cancel();
  expect(attempt.active).toBe(false);
  fail(new Error("late failure"));
  await vi.waitFor(() => expect(consume.mock.calls[0]?.[0]?.aborted).toBe(true));
  expect(onFailure).not.toHaveBeenCalled();
});

it("an older cancelled completion cannot clear a newer attempt", async () => {
  const attempt = createHandoffAttempt();
  let finish!: () => void;
  attempt.start(() => new Promise<void>((resolve) => { finish = resolve; }), vi.fn());
  await Promise.resolve();
  attempt.cancel();
  const onFailure = vi.fn();
  attempt.start(async () => { await new Promise(() => {}); }, onFailure);
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(attempt.active).toBe(true);
  attempt.cancel();
});

it("reports terminal errors and permits an explicit retry", async () => {
  const attempt = createHandoffAttempt();
  const onFailure = vi.fn();
  const failure = new Error("Unauthorized");
  attempt.start(async () => { throw failure; }, onFailure);
  await vi.waitFor(() => expect(attempt.active).toBe(false));
  expect(onFailure).toHaveBeenCalledExactlyOnceWith(failure);
  const retry = vi.fn(async () => true);
  attempt.start(retry, onFailure);
  await vi.waitFor(() => expect(attempt.active).toBe(false));
  expect(retry).toHaveBeenCalledTimes(1);
});

it("waits for creation using the complete bound one-use RPC, then stops", async () => {
  vi.useFakeTimers();
  const ready = Response.json({ ciphertext: "sealed" });
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 410 })).mockResolvedValueOnce(ready);
  vi.stubGlobal("fetch", fetcher);
  const result = fetchHandoffResponse(binding, { waitForCreation: true });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await result).toBe(ready);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]).toEqual([
    "/api/key-handoffs/synthetic-transaction/consume",
    expect.objectContaining({ method: "POST", credentials: "include", cache: "no-store", body: JSON.stringify(binding) }),
  ]);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([401, 403, 429, 500])("does not retry HTTP %i", async (status) => {
  const response = new Response(null, { status });
  const fetcher = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetcher);
  expect(await fetchHandoffResponse(binding, { waitForCreation: true })).toBe(response);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("keeps immediate iframe consumption single-shot", async () => {
  const response = new Response(null, { status: 410 });
  const fetcher = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetcher);
  expect(await fetchHandoffResponse(binding)).toBe(response);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("cancels a pending attempt without another consume request", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 410 }));
  vi.stubGlobal("fetch", fetcher);
  const result = fetchHandoffResponse(binding, { waitForCreation: true, signal: controller.signal });
  const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(500);
  controller.abort();
  await assertion;
  await vi.advanceTimersByTimeAsync(5_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects a response that arrives after cancellation", async () => {
  const controller = new AbortController();
  vi.stubGlobal("fetch", vi.fn(async () => {
    controller.abort();
    return Response.json({ ciphertext: "sealed" });
  }));
  await expect(fetchHandoffResponse(binding, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
});

it("bounds waiting to two minutes", async () => {
  vi.useFakeTimers();
  // The native AbortSignal timeout uses real timers; emulate its event with
  // fake timers so this exercises the deadline rather than waiting two minutes.
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Deadline", "TimeoutError")), delay);
    return controller.signal;
  });
  const fetcher = vi.fn().mockImplementation(async () => new Response(null, { status: 410 }));
  vi.stubGlobal("fetch", fetcher);
  try {
    const result = fetchHandoffResponse(binding, { waitForCreation: true });
    const assertion = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(120);
  } finally { timeout.mockRestore(); }
});
