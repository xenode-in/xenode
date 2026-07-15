import StorageObject from "@/models/StorageObject";
import DirectShare from "@/models/DirectShare";
import type { IDirectShareRecipient } from "@/models/DirectShare";
import type { IFileComment } from "@/models/FileComment";
import { objectFilter } from "@/lib/authz";
import type { AccessContext } from "@/lib/authz/space-context";
import {
  canComment as roleCanComment,
  normalizeShareRole,
  type ShareRole,
} from "@/lib/orgs/shareRoles";

export function serializeComment(comment: IFileComment, callerUserId: string) {
  return {
    id: String(comment._id),
    parentId: comment.parentId ? String(comment.parentId) : null,
    authorUserId: comment.authorUserId,
    authorEmail: comment.authorEmail ?? null,
    ciphertext: comment.ciphertext,
    status: comment.status ?? "open",
    resolvedBy: comment.resolvedBy ?? null,
    resolvedAt: comment.resolvedAt ?? null,
    createdAt: comment.createdAt,
    mine: comment.authorUserId === callerUserId,
  };
}

export interface CommentAccess {
  /** How the caller reaches this file's comments. */
  via: "workspace" | "share";
  /** Share role when via=share; workspace access implies full participation. */
  role: ShareRole | null;
  canComment: boolean;
  /** The share the caller posts through, when they are a recipient. */
  directShareId: string | null;
}

/**
 * Comments belong to the FILE (Google Drive semantics), so access is dual:
 *  - workspace access — the personal owner or an org/team member reaching the
 *    object through their scoped context (org guests are read-only), or
 *  - share access — a recipient of any active DirectShare of the object,
 *    posting allowed from `commenter` upward.
 * Returns null when the caller has neither (treat as 404 — don't leak that
 * the object exists).
 */
export async function resolveCommentAccess(
  ctx: AccessContext,
  objectId: string,
): Promise<CommentAccess | null> {
  if (!/^[a-f\d]{24}$/i.test(objectId)) return null;

  const owned = await StorageObject.findOne({
    ...objectFilter(ctx, objectId),
    deletedAt: { $exists: false },
  })
    .select("_id")
    .lean();
  if (owned) {
    const canWrite =
      ctx.spaceType === "personal" || ctx.role !== "guest";
    return {
      via: "workspace",
      role: null,
      canComment: canWrite,
      directShareId: null,
    };
  }

  const share = await DirectShare.findOne({
    objectId,
    isRevoked: false,
    "recipients.recipientUserId": ctx.userId,
  })
    .select("_id recipients")
    .lean();
  if (!share) return null;

  const recipient = (share.recipients as IDirectShareRecipient[]).find(
    (item) => item.recipientUserId === ctx.userId,
  );
  const role = normalizeShareRole(recipient?.accessType);
  return {
    via: "share",
    role,
    canComment: roleCanComment(role),
    directShareId: String(share._id),
  };
}
