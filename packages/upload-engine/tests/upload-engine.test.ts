import { describe, expect, it } from "vitest";
import { UploadEngine, type CheckpointStore } from "../src";

function memoryCheckpoints(): CheckpointStore {
  const values = new Map();
  return {
    async load(id) {
      return values.get(id) ?? null;
    },
    async save(checkpoint) {
      values.set(checkpoint.uploadId, checkpoint);
    },
    async remove(id) {
      values.delete(id);
    },
  };
}

describe("UploadEngine", () => {
  it("injects product policy and resumes from checkpoints", async () => {
    let receivedOffset = 0;
    const checkpoints = memoryCheckpoints();
    await checkpoints.save({ uploadId: "one", offset: 512 });
    const engine = new UploadEngine(
      {
        async upload(input, checkpoint) {
          receivedOffset = checkpoint?.offset ?? 0;
          return input.name;
        },
      },
      {
        validate(input) {
          if (!input.contentType.startsWith("image/")) throw new Error("policy");
        },
      },
      checkpoints,
      { retryDelayMs: () => 0 },
    );

    await expect(
      engine.enqueue({
        id: "one",
        name: "photo.jpg",
        size: 1024,
        contentType: "image/jpeg",
        source: null,
      }),
    ).resolves.toMatchObject({ status: "completed", value: "photo.jpg" });
    expect(receivedOffset).toBe(512);
    await expect(
      engine.enqueue({
        id: "two",
        name: "file.pdf",
        size: 1,
        contentType: "application/pdf",
        source: null,
      }),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("retries transient failures without exceeding max attempts", async () => {
    let attempts = 0;
    const engine = new UploadEngine(
      {
        async upload() {
          attempts += 1;
          if (attempts < 3) throw new Error("temporary");
          return "ok";
        },
      },
      { validate() {} },
      memoryCheckpoints(),
      { maxAttempts: 3, retryDelayMs: () => 0 },
    );
    await expect(
      engine.enqueue({
        id: "retry",
        name: "x",
        size: 1,
        contentType: "x/test",
        source: null,
      }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(attempts).toBe(3);
  });
});
