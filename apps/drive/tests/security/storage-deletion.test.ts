import { DeleteObjectsCommand, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/b2/client", () => ({ getS3Client: () => ({ send }) }));

import { deleteObjects } from "@/lib/b2/objects";

const bucket = "xenode-drive-storage";

describe("physical B2 version deletion", () => {
  beforeEach(() => { send.mockReset(); });

  it("deletes exact versions and markers, ignoring keys with the same prefix", async () => {
    const versions = new Set(["v1", "v2", "marker"]);
    send.mockImplementation(async (command) => {
      if (command instanceof ListObjectVersionsCommand) return {
        Versions: [...versions].filter((id) => id !== "marker").map((VersionId) => ({ Key: "users/account/file", VersionId })),
        DeleteMarkers: [
          ...(versions.has("marker") ? [{ Key: "users/account/file", VersionId: "marker" }] : []),
          { Key: "users/account/file-thumb", VersionId: "other" },
        ],
      };
      if (command instanceof DeleteObjectsCommand) {
        for (const entry of command.input.Delete?.Objects ?? []) versions.delete(entry.VersionId!);
        return {};
      }
      throw new Error("Unexpected storage command");
    });
    await deleteObjects(bucket, ["users/account/file", "users/account/file", ""]);
    expect(versions.size).toBe(0);
    const deletes = send.mock.calls.filter(([command]) => command instanceof DeleteObjectsCommand);
    expect(deletes).toHaveLength(1);
    expect((deletes[0][0] as DeleteObjectsCommand).input.Delete?.Objects).toEqual([
      { Key: "users/account/file", VersionId: "v1" },
      { Key: "users/account/file", VersionId: "v2" },
      { Key: "users/account/file", VersionId: "marker" },
    ]);
    expect(send).toHaveBeenCalledTimes(3); // discover, version-delete, confirm empty
  });

  it("sweeps more than 1,000 versions in bounded batches", async () => {
    const versions = Array.from({ length: 1001 }, (_, index) => `v${index}`);
    send.mockImplementation(async (command) => {
      if (command instanceof ListObjectVersionsCommand) return {
        Versions: versions.slice(0, 1000).map((VersionId) => ({ Key: "file", VersionId })),
      };
      if (command instanceof DeleteObjectsCommand) {
        const batch = command.input.Delete?.Objects ?? [];
        expect(batch.length).toBeLessThanOrEqual(1000);
        versions.splice(0, batch.length);
        return {};
      }
      throw new Error("Unexpected storage command");
    });
    await deleteObjects(bucket, ["file"]);
    expect(versions).toHaveLength(0);
    expect(send.mock.calls.filter(([command]) => command instanceof DeleteObjectsCommand)).toHaveLength(2);
  });

  it("rejects a per-version failure and preserves caller metadata for retry", async () => {
    send.mockImplementation(async (command) => command instanceof ListObjectVersionsCommand
      ? { Versions: [{ Key: "file", VersionId: "v1" }] }
      : { Errors: [{ Key: "file", VersionId: "v1", Code: "AccessDenied" }] });
    await expect(deleteObjects(bucket, ["file"])).rejects.toThrow("failed to delete 1 requested objects");
  });

  it("fails closed when the provider omits version identity", async () => {
    send.mockResolvedValue({ Versions: [{ Key: "file" }] });
    await expect(deleteObjects(bucket, ["file"])).rejects.toThrow("omitted a version ID");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("propagates listing failure before any delete", async () => {
    send.mockRejectedValue(new Error("storage unavailable"));
    await expect(deleteObjects(bucket, ["file"])).rejects.toThrow("storage unavailable");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not claim success while versions keep appearing", async () => {
    send.mockImplementation(async (command) => command instanceof ListObjectVersionsCommand
      ? { Versions: [{ Key: "file", VersionId: "v1" }] }
      : {});
    await expect(deleteObjects(bucket, ["file"])).rejects.toThrow("still has versions");
    expect(send.mock.calls.filter(([command]) => command instanceof DeleteObjectsCommand)).toHaveLength(10);
  });
});
