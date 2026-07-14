import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import { orgObjectClause } from "@/lib/orgs/storage";
import {
  ORG_FREE_SEATS,
  ORG_FREE_TIER_LIMIT_BYTES,
} from "@/models/OrgUsage";
import OrgUsage from "@/models/OrgUsage";
import ActivityLog from "@/models/ActivityLog";
import AccessRequest from "@/models/AccessRequest";
import StorageObject from "@/models/StorageObject";

export interface OrgHomeSummary {
  storage: { usedBytes: number; limitBytes: number | null };
  seats: { used: number; total: number };
  memberCount: number;
  pendingRequests: number;
  fileCount: number;
  recentActivity: Array<{
    id: string;
    action: string;
    actorUserId: string | null;
    createdAt: string;
  }>;
  recentFiles: Array<{ id: string; size: number; createdAt: string }>;
}

/**
 * Aggregate for the org Home dashboard. BILLING_SECURITY-safe: reads only
 * OrgUsage (bytes/seats), ActivityLog, AccessRequest counts, member count, and
 * opaque object ids/sizes — never plaintext file names/keys or crypto fields.
 * Server-side (no HTTP hop).
 */
export async function getOrgHomeSummary(args: {
  orgId: string;
}): Promise<OrgHomeSummary> {
  const { orgId } = args;
  await dbConnect();

  const [usage, memberCount, pendingRequests, fileCount, activity, files] =
    await Promise.all([
      OrgUsage.findOne({ orgId }).lean(),
      mongoose.connection
        .collection("member")
        .countDocuments({ organizationId: orgId }),
      AccessRequest.countDocuments({ orgId, status: "pending" }),
      StorageObject.countDocuments({
        ...orgObjectClause(orgId),
        deletedAt: { $exists: false },
      }),
      ActivityLog.find({ orgId }).sort({ _id: -1 }).limit(5).lean(),
      StorageObject.find({
        ...orgObjectClause(orgId),
        deletedAt: { $exists: false },
      })
        .select("size createdAt")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
    ]);

  return {
    storage: {
      usedBytes: usage?.totalStorageBytes ?? 0,
      limitBytes: usage ? usage.storageLimitBytes : ORG_FREE_TIER_LIMIT_BYTES,
    },
    seats: {
      used: usage?.seatsUsed ?? 0,
      total: usage?.seats ?? ORG_FREE_SEATS,
    },
    memberCount,
    pendingRequests,
    fileCount,
    recentActivity: activity.map((a) => ({
      id: String(a._id),
      action: a.action,
      actorUserId: a.actorUserId ?? null,
      createdAt: (a.createdAt ?? new Date()).toISOString(),
    })),
    recentFiles: files.map((f) => ({
      id: String(f._id),
      size: f.size ?? 0,
      createdAt: (f.createdAt ?? new Date()).toISOString(),
    })),
  };
}
