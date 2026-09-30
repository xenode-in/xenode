import { afterEach, describe, expect, it, vi } from "vitest";
import { binMutationFetch } from "@/lib/storage/bin-client";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
describe("bounded Bin actions", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("splits selection into 100-object requests and reports pending work", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ queuedCount: 100, pendingCount: 100 },202)).mockResolvedValueOnce(json({ queuedCount: 1, purgedCount: 1 }));
    vi.stubGlobal("fetch",fetch);
    const response = await binMutationFetch("/purge", { method:"POST", body:JSON.stringify({ ids:Array.from({ length:101 },(_,index)=>String(index)) }) });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[0][1].body).ids).toHaveLength(100);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ queuedCount:101,pendingCount:100,purgedCount:1 });
  });
  it("continues Empty Bin until no new objects remain", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ queuedCount:100,pendingCount:100,hasMore:true },202)).mockResolvedValueOnce(json({ queuedCount:3,pendingCount:3,hasMore:false },202));
    vi.stubGlobal("fetch",fetch);
    const response = await binMutationFetch("/purge",{ method:"POST",body:JSON.stringify({ all:true }) });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await response.json()).queuedCount).toBe(103);
  });
  it("stops at a failed batch without claiming complete success", async () => {
    const fetch=vi.fn().mockResolvedValue(json({ error:"cleanup will retry" },500));
    vi.stubGlobal("fetch",fetch);
    expect((await binMutationFetch("/purge",{ method:"POST",body:JSON.stringify({ all:true }) })).status).toBe(500);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
