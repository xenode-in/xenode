import mongoose, { Schema } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, describe, expect, it } from "vitest";
import { connectDatabase, disconnectDatabaseForTests } from "../src/connection";

let server: MongoMemoryServer | undefined;

afterAll(async () => {
  await disconnectDatabaseForTests();
  await server?.stop();
});

describe("database connection", () => {
  it("initializes a model first defined while the connection is opening", async () => {
    server = await MongoMemoryServer.create();
    const connecting = connectDatabase(server.getUri());
    // Like a route module loaded mid-connect: Mongoose starts this model's
    // one-time init() now and keeps its outcome.
    const name = `LateModel_${Date.now()}`;
    const Late = mongoose.model(name, new Schema({ value: { type: String, unique: true } }));
    await connecting;

    await Late.init();
    await Late.create({ value: "once" });
    await expect(Late.create({ value: "once" })).rejects.toThrow(/duplicate key/);
    mongoose.deleteModel(name);
  });
});
