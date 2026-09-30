/** Bound each request while completing a selected/whole Bin action. */
export async function binMutationFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  if (!body.all && !Array.isArray(body.ids)) return fetch(input, init);
  const batches = Array.isArray(body.ids)
    ? Array.from({ length: Math.ceil(body.ids.length / 100) }, (_, index) => ({ ...body, ids: body.ids.slice(index * 100, index * 100 + 100) }))
    : [body];
  let purgedCount = 0, queuedCount = 0, pendingCount = 0;
  for (const batch of batches) {
    for (;;) {
      const response = await fetch(input, { ...init, body: JSON.stringify(batch) });
      if (!response.ok) return response;
      const result = await response.json();
      purgedCount += result.purgedCount ?? 0; queuedCount += result.queuedCount ?? 0; pendingCount += result.pendingCount ?? 0;
      if (!batch.all || !result.hasMore || !result.queuedCount) break;
    }
  }
  return new Response(JSON.stringify({ success: true, purgedCount, queuedCount, pendingCount }), {
    status: pendingCount ? 202 : 200, headers: { "Content-Type": "application/json" },
  });
}
