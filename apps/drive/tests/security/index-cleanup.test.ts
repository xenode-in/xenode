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

  it("declares regional system bucket uniqueness indexes once", () => {
    const indexes = Bucket.schema.indexes() as SchemaIndex[];

    const bucketIdIndexes = indexes.filter(([keys]) => {
      const fields = Object.keys(keys);
      return fields.length === 1 && fields[0] === "b2BucketId";
    });
    expect(bucketIdIndexes).toHaveLength(1);
    expect(bucketIdIndexes[0]?.[1]).toMatchObject({ unique: true });

    const regionalSystemKeyIndexes = indexes.filter(([keys]) => {
      const fields = Object.keys(keys);
      return (
        fields.length === 2 &&
        keys.systemKey === 1 &&
        keys.storageRegion === 1
      );
    });
    expect(regionalSystemKeyIndexes).toHaveLength(1);
    expect(regionalSystemKeyIndexes[0]?.[1]).toMatchObject({ unique: true });
  });
});
