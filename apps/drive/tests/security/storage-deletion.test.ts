import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/b2/client", () => ({ getS3Client: () => ({ send }) }));

import { deleteObjects } from "@/lib/b2/objects";

describe("confirmed object storage deletion", () => {
  beforeEach(() => { send.mockReset(); });

  it("deduplicates keys and respects the 1,000-key storage batch limit", async () => {
    send.mockResolvedValue({});
    const keys = Array.from({ length: 1001 }, (_, index) => `users/account/${index}`);
    await deleteObjects("xenode-drive-storage", [...keys, keys[0], ""]);
    expect(send).toHaveBeenCalledTimes(2);
    const commands = send.mock.calls.map(([command]) => command as DeleteObjectsCommand);
    expect(commands[0].input.Delete?.Objects).toHaveLength(1000);
    expect(commands[1].input.Delete?.Objects).toEqual([{ Key: keys[1000] }]);
  });

  it("rejects HTTP-success responses containing per-key failures", async () => {
    send.mockResolvedValue({ Errors: [{ Key: "users/account/key", Code: "AccessDenied" }] });
    await expect(deleteObjects("xenode-drive-storage", ["users/account/key"]))
      .rejects.toThrow("failed to delete 1 requested objects");
  });

  it("propagates a transport failure and stops subsequent batches", async () => {
    send.mockRejectedValue(new Error("storage unavailable"));
    await expect(deleteObjects("xenode-drive-storage", Array.from({ length: 1001 }, (_, i) => `key-${i}`)))
      .rejects.toThrow("storage unavailable");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
