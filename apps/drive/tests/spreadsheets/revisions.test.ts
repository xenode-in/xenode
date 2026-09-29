import { describe, expect, it } from "vitest";
import { parseBaseRevision } from "@/lib/storage/revisions";
import { assertScopeAction } from "@/lib/authz/policy";
import type { AccessContext } from "@/lib/authz/space-context";

describe("spreadsheet optimistic concurrency", () => {
  it("validates safe integer base revisions", () => {
    expect(parseBaseRevision("3")).toBe(3);
    expect(Number.isNaN(parseBaseRevision("stale"))).toBe(true);
    expect(parseBaseRevision("0")).toBe(0);
    expect(Number.isNaN(parseBaseRevision("-1"))).toBe(true);
  });

  it("keeps organization guests read-only while members may save", () => {
    const base = { userId: "u", session: {} } as unknown as AccessContext;
    expect(() =>
      assertScopeAction({ ...base, role: "member" }, "write"),
    ).not.toThrow();
    expect(() => assertScopeAction({ ...base, role: "guest" }, "write"))
      .toThrowError(/Forbidden/);
  });
});

