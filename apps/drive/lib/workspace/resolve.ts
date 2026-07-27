import { type AccessContext } from "@/lib/authz/space-context";
import {
  getBucketForWorkspace,
  type WorkspaceStorageType,
} from "@/lib/storage/workspaceBucket";
import {
  orgObjectKeyPrefix,
  orgStorageOwnerId,
  teamObjectKeyPrefix,
} from "@/lib/orgs/storage";

/**
 * ── Workspace abstraction ────────────────────────────────────────────────────
 * `workspaceId` is Xenode's universal tenant key. Personal and organization
 * workspaces both resolve to one shape so future products (Mail, Docs, Editor,
 * AI, Calendar) can accept a `workspaceId` instead of branching on
 * `userId` vs `orgId`. This is a thin resolution layer over the existing
 * AccessContext + storage helpers — no new persistence today.
 */
export type WorkspaceType = "personal" | "organization" | "team";

export interface ResolvedWorkspace {
  /** Universal tenant id: `ws_personal_{userId}` for personal, the orgId for org/team. */
  workspaceId: string;
  type: WorkspaceType;
  /** Storage owner id stamped on Bucket/StorageObject: `userId` or `org:{orgId}`. */
  ownerId: string;
  /** Which of the two shared buckets backs this workspace's storage. */
  bucketType: WorkspaceStorageType;
  /** Resolved B2 bucket name for `bucketType`. */
  bucketName: string;
  /** Immutable object-key prefix for this workspace. */
  keyPrefix: string;
}

/** Canonical personal workspace id for a user. */
export function personalWorkspaceId(userId: string): string {
  return `ws_personal_${userId}`;
}

/**
 * Resolve the workspace the request is acting within, derived from the
 * already-resolved tenancy scope on `AccessContext`.
 */
export function resolveWorkspace(ctx: AccessContext): ResolvedWorkspace {
  if (
    (ctx.spaceType === "organization" || ctx.spaceType === "team") &&
    ctx.organizationId
  ) {
    return {
      workspaceId: ctx.spaceId,
      type: ctx.spaceType,
      ownerId: orgStorageOwnerId(ctx.organizationId),
      bucketType: "ORGANIZATION",
      bucketName: getBucketForWorkspace("ORGANIZATION", ctx.region),
      keyPrefix:
        ctx.spaceType === "team" && ctx.teamId
          ? teamObjectKeyPrefix(ctx.organizationId, ctx.teamId)
          : orgObjectKeyPrefix(ctx.organizationId),
    };
  }

  return {
    workspaceId: ctx.spaceId,
    type: "personal",
    ownerId: ctx.userId,
    bucketType: "PERSONAL",
    bucketName: getBucketForWorkspace("PERSONAL", ctx.region),
    keyPrefix: `users/${ctx.userId}/`,
  };
}
