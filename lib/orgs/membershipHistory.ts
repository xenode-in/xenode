import mongoose from "mongoose";
import OrgMembershipHistory from "@/models/OrgMembershipHistory";

/**
 * Membership-history helpers. The live `member` row is hard-deleted on removal,
 * so we persist a tombstone here to (a) audit departures and (b) warn admins
 * when a previously-removed email is re-invited.
 */

function userEmailLookup(userId: string) {
  const clauses: Array<Record<string, unknown>> = [{ id: userId }];
  if (mongoose.Types.ObjectId.isValid(userId)) {
    clauses.push({ _id: new mongoose.Types.ObjectId(userId) });
  }
  return { $or: clauses };
}

/**
 * Record that a user has left / been removed from an org. Fire-and-forget:
 * never throws out of the caller — a failed tombstone must not break removal.
 */
export async function recordMembershipDeparture(args: {
  orgId: string;
  userId: string;
  role?: string | null;
  joinedAt?: Date | null;
  removedBy?: string | null;
  reason?: "removed" | "left";
  email?: string | null;
}): Promise<void> {
  try {
    let email = args.email ?? null;
    if (!email) {
      const user = await mongoose.connection
        .collection<{ email?: string }>("user")
        .findOne(userEmailLookup(args.userId), { projection: { email: 1 } });
      email = user?.email ? String(user.email).toLowerCase() : null;
    }

    await OrgMembershipHistory.create({
      orgId: args.orgId,
      userId: args.userId,
      email,
      role: args.role ?? null,
      joinedAt: args.joinedAt ?? null,
      removedAt: new Date(),
      removedBy: args.removedBy ?? null,
      reason: args.reason ?? "removed",
    });
  } catch (error) {
    console.error("[OrgMembershipHistory] record failed", {
      orgId: args.orgId,
      userId: args.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Most-recent departure record for an email in an org, or null. Used by the
 * invite flow to surface a "previously a member" notice.
 */
export async function findLastDeparture(
  orgId: string,
  email: string,
): Promise<{ removedAt: Date; role: string | null } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const record = await OrgMembershipHistory.findOne({ orgId, email: normalized })
    .sort({ removedAt: -1 })
    .select("removedAt role")
    .lean<{ removedAt: Date; role: string | null }>();
  return record
    ? { removedAt: record.removedAt, role: record.role ?? null }
    : null;
}
