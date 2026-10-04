import { Types } from "mongoose";
import { DRIVE_FOLDER_CONTENT_TYPE } from "@xenode/database";
import { AuthzError } from "@/lib/authz";
import type { AccessContext } from "@/lib/authz/space-context";
import { orgObjectKeyPrefix, teamObjectKeyPrefix } from "@/lib/orgs/storage";

export { DRIVE_FOLDER_CONTENT_TYPE };

/**
 * Physical key namespace of the Space. Keys are `<root><random hex32>` (plus
 * server-derived suffixes); they identify ciphertext and never encode where an
 * item appears in the folder tree.
 */
export function spaceStorageRoot(
  ctx: Pick<AccessContext, "spaceType" | "organizationId" | "teamId" | "accountId">,
): string {
  if (ctx.spaceType === "organization") return orgObjectKeyPrefix(ctx.organizationId!);
  if (ctx.spaceType === "team") {
    return teamObjectKeyPrefix(ctx.organizationId!, ctx.teamId!);
  }
  return `users/${ctx.accountId}/`;
}

export function isFolderObject(object: { contentType?: string | null }): boolean {
  return object.contentType === DRIVE_FOLDER_CONTENT_TYPE;
}

/** `folder` query parameter: absent or "root" is the Space root. */
export function parseFolderParam(value: string | null): Types.ObjectId | null {
  if (value === null || value === "" || value === "root") return null;
  if (!/^[a-f0-9]{24}$/iu.test(value)) {
    throw new AuthzError(400, "invalid_folder", "Invalid folder");
  }
  return new Types.ObjectId(value);
}

/** Stable cache/event identity of a folder listing. */
export function folderListingId(
  folderId: { toString(): string } | null | undefined,
): string {
  return folderId ? folderId.toString() : "root";
}
