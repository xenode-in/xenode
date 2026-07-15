import { describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  productSlugSchema,
  spaceRoleSchema,
  syncEventSchema,
} from "../src";

describe("shared contracts", () => {
  it("keeps the product registry closed", () => {
    expect(productSlugSchema.parse("photos")).toBe("photos");
    expect(() => productSlugSchema.parse("unknown")).toThrow();
  });

  it("does not accept the removed manager role", () => {
    expect(spaceRoleSchema.safeParse("manager").success).toBe(false);
  });

  it("requires product and space binding on sync events", () => {
    const result = syncEventSchema.safeParse({
      eventId: "evt_1",
      occurredAt: new Date().toISOString(),
      accountId: "account_1",
      type: "object.updated",
      objectId: "object_1",
    });
    expect(result.success).toBe(false);
  });

  it("uses stable machine-readable error codes", () => {
    expect(
      apiErrorSchema.parse({
        error: { code: "FORBIDDEN", message: "Access denied" },
      }).error.code,
    ).toBe("FORBIDDEN");
  });
});
