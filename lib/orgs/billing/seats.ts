import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import { AuthzError } from "@/lib/authz";
import OrgUsage, { ORG_FREE_SEATS } from "@/models/OrgUsage";

/**
 * Seat accounting for organization billing.
 *
 * A "seat" is consumed by each non-guest member (guests are free). `seatsUsed`
 * on OrgUsage is a cache kept in sync with the `member` collection; the hard
 * enforcement point is invite creation, which counts live members + pending
 * non-guest invites so an org can't over-provision beyond its purchased seats.
 */

export async function countNonGuestMembers(orgId: string): Promise<number> {
  await dbConnect();
  return mongoose.connection
    .collection("member")
    .countDocuments({ organizationId: orgId, role: { $ne: "guest" } });
}

async function countPendingNonGuestInvites(orgId: string): Promise<number> {
  await dbConnect();
  return mongoose.connection.collection("invitation").countDocuments({
    organizationId: orgId,
    status: "pending",
    role: { $ne: "guest" },
  });
}

export async function getSeatLimit(orgId: string): Promise<number> {
  await dbConnect();
  const usage = await OrgUsage.findOne({ orgId }).lean();
  return usage?.seats ?? ORG_FREE_SEATS;
}

/** Recount non-guest members and cache the result on OrgUsage.seatsUsed. */
export async function syncSeatsUsed(orgId: string): Promise<number> {
  const used = await countNonGuestMembers(orgId);
  await OrgUsage.updateOne(
    { orgId },
    { $set: { seatsUsed: used } },
    { upsert: true },
  );
  return used;
}

/**
 * Throw 409 if inviting another non-guest member would exceed the seat limit.
 * Counts current non-guest members + pending non-guest invitations.
 */
export async function assertSeatHeadroomForInvite(orgId: string): Promise<void> {
  const [limit, members, pending] = await Promise.all([
    getSeatLimit(orgId),
    countNonGuestMembers(orgId),
    countPendingNonGuestInvites(orgId),
  ]);
  if (members + pending >= limit) {
    throw new AuthzError(
      409,
      "seat_limit_reached",
      `This organization has reached its seat limit (${limit}). Upgrade your plan or free a seat to invite more members.`,
    );
  }
}

export async function getSeatState(orgId: string): Promise<{
  seats: number;
  seatsUsed: number;
  pendingInvites: number;
}> {
  const [limit, members, pending] = await Promise.all([
    getSeatLimit(orgId),
    countNonGuestMembers(orgId),
    countPendingNonGuestInvites(orgId),
  ]);
  return { seats: limit, seatsUsed: members, pendingInvites: pending };
}
