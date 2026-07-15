import mongoose, { Schema } from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { getModel } from "../src/model";
import { createAccountRepository } from "../src/repositories/accounts";

describe("database package", () => {
  it("reuses an already registered model without deleting it", () => {
    const name = `DatabasePackageTest_${Date.now()}`;
    const schema = new Schema({ value: String });
    const first = getModel(name, schema);
    const second = getModel(name, schema);
    expect(second).toBe(first);
    mongoose.deleteModel(name);
  });

  it("queries both string and ObjectId better-auth user ids", async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const find = vi.fn().mockReturnValue({ toArray });
    const collection = vi.fn().mockReturnValue({ find });
    const repository = createAccountRepository({
      collection,
    } as never);
    const userId = new mongoose.Types.ObjectId().toString();

    await repository.listForUser(userId);

    expect(collection).toHaveBeenCalledWith("account");
    const filter = find.mock.calls[0]?.[0] as {
      userId: { $in: unknown[] };
    };
    expect(filter.userId.$in).toHaveLength(2);
    expect(toArray).toHaveBeenCalledOnce();
  });
});
