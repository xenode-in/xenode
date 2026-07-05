import dbConnect from "@/lib/mongodb";
import { sanitize } from "@/lib/audit/sanitize";
import ActivityLog, { type ActivityActorType } from "@/models/ActivityLog";

/**
 * Organization activity emitter — the org analogue of `emitBillingEvent`.
 *
 * Writes one ActivityLog row per call. Fire-and-forget by design: NEVER throws
 * out of the caller; a failed audit write must not break the surrounding org
 * operation. Payload is PII-stripped via the shared sanitizer.
 */
export interface EmitActivityArgs {
  orgId: string;
  action: string;
  actorUserId?: string | null;
  actorType?: ActivityActorType;
  target?: { type: string; id?: string | null } | null;
  metadata?: Record<string, unknown>;
}

export async function emitActivity(args: EmitActivityArgs): Promise<void> {
  try {
    await dbConnect();
    await ActivityLog.create({
      orgId: args.orgId,
      action: args.action,
      actorUserId: args.actorUserId ?? null,
      actorType: args.actorType ?? "user",
      target: args.target
        ? { type: args.target.type, id: args.target.id ?? null }
        : null,
      metadata: sanitize(args.metadata ?? {}),
    });
  } catch (error) {
    // Audit failures must not block the org operation. Log loudly.
    console.error("[ActivityLog] emit failed", {
      orgId: args.orgId,
      action: args.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Known org activity actions — keeps usage greppable (mirrors BillingEventType). */
export const ActivityAction = {
  ORG_CREATED: "org.created",
  ORG_SETTINGS_UPDATED: "org.settings_updated",
  ORG_OWNERSHIP_TRANSFERRED: "org.ownership_transferred",
  ORG_DELETED: "org.deleted",
  ORG_RESTORED: "org.restored",
  MEMBER_INVITE_CANCELLED: "member.invite_cancelled",

  MEMBER_INVITED: "member.invited",
  MEMBER_JOINED: "member.joined",
  MEMBER_INVITE_REJECTED: "member.invite_rejected",
  MEMBER_REMOVED: "member.removed",
  MEMBER_ROLE_CHANGED: "member.role_changed",

  TEAM_CREATED: "team.created",
  TEAM_DELETED: "team.deleted",
  TEAM_MEMBER_ADDED: "team.member_added",
  TEAM_MEMBER_REMOVED: "team.member_removed",

  DOMAIN_ADDED: "domain.added",
  DOMAIN_VERIFIED: "domain.verified",
  DOMAIN_VERIFICATION_FAILED: "domain.verification_failed",

  BUCKET_CREATED: "bucket.created",
  FILE_UPLOADED: "file.uploaded",
  FILE_DELETED: "file.deleted",

  BILLING_CHECKOUT_STARTED: "billing.checkout_started",
  BILLING_SEATS_CHANGED: "billing.seats_changed",
} as const;
