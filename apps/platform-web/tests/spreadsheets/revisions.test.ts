import { describe, expect, it } from "vitest";
import { parseBaseRevision, revisionFilter } from "@/lib/storage/revisions";
import { assertScopeAction } from "@/lib/authz/policy";
import type { AccessContext } from "@/lib/authz/space-context";

describe("spreadsheet optimistic concurrency", () => {
  it("validates revisions and supports unmigrated revision zero rows", () => {
    expect(parseBaseRevision("3")).toBe(3);
    expect(Number.isNaN(parseBaseRevision("stale"))).toBe(true);
    expect(revisionFilter(0)).toEqual({ $or: [{ revision: 0 }, { revision: { $exists: false } }] });
    expect(revisionFilter(4)).toEqual({ revision: 4 });
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

