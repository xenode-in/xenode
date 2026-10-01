import { DeleteObjectsCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/b2/client", () => ({ getS3Client: () => ({ send }) }));

import { deleteObjects } from "@/lib/b2/objects";

const bucket = "xenode-drive-storage";
const missing = { name: "NotFound", $metadata: { httpStatusCode: 404 } };

describe("confirmed S3-compatible object deletion", () => {
  beforeEach(() => { send.mockReset(); });

  it("deduplicates exact keys and respects the 1,000-key batch limit", async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof DeleteObjectsCommand) return {};
      if (command instanceof HeadObjectCommand) throw missing;
      throw new Error("Unsupported storage command");
    });
    const keys = Array.from({ length: 1001 }, (_, index) => `users/account/${index}`);
    await deleteObjects(bucket, [...keys, keys[0], ""]);
    const deletes = send.mock.calls.filter(([command]) => command instanceof DeleteObjectsCommand);
    expect(deletes).toHaveLength(2);
    expect((deletes[0][0] as DeleteObjectsCommand).input.Delete?.Objects).toHaveLength(1000);
    expect((deletes[1][0] as DeleteObjectsCommand).input.Delete?.Objects).toEqual([{ Key: keys[1000] }]);
    expect(send.mock.calls.filter(([command]) => command instanceof HeadObjectCommand)).toHaveLength(1001);
  });

  it("rejects a per-key failure before retiring caller metadata", async () => {
    send.mockResolvedValue({ Errors: [{ Key: "file", Code: "AccessDenied" }] });
    await expect(deleteObjects(bucket, ["file"])).rejects.toThrow("failed to delete 1 requested objects");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("fails when HEAD still sees a key", async () => {
    send.mockResolvedValue({});
    await expect(deleteObjects(bucket, ["file"])).rejects.toThrow("deletion is unconfirmed");
    expect(send.mock.calls[1][0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("does not mistake a permission or transport failure for absence", async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof DeleteObjectsCommand) return {};
      throw { name: "AccessDenied", $metadata: { httpStatusCode: 403 } };
    });
    await expect(deleteObjects(bucket, ["file"])).rejects.toMatchObject({ name: "AccessDenied" });
  });
});
