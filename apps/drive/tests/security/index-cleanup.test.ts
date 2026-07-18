import { describe, expect, it } from "vitest";
import Bucket from "@/models/Bucket";
import StorageObject from "@/models/StorageObject";

type SchemaIndex = [Record<string, unknown>, Record<string, unknown>];

describe("Drive database index cleanup", () => {
  it("does not recreate the deletedAt_1 TTL hazard", () => {
    const indexes = StorageObject.schema.indexes() as SchemaIndex[];
    const deletedAtOnly = indexes.find(([keys]) => {
      const fields = Object.keys(keys);
      return fields.length === 1 && fields[0] === "deletedAt";
    });

    expect(deletedAtOnly).toBeUndefined();
  });

  it("declares each system bucket uniqueness index once", () => {
    const indexes = Bucket.schema.indexes() as SchemaIndex[];

    for (const field of ["systemKey", "b2BucketId"]) {
      const matches = indexes.filter(([keys]) => {
        const fields = Object.keys(keys);
        return fields.length === 1 && fields[0] === field;
      });
      expect(matches).toHaveLength(1);
      expect(matches[0]?.[1]).toMatchObject({ unique: true });
    }
  });
});
