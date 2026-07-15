import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import {
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import {
  assertOrgMemberRole,
  type OrgMemberRecord,
  type UserRecord,
} from "@/lib/orgs/access";
import dbConnect from "@/lib/mongodb";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

function serializeUser(user?: UserRecord) {
  return user
    ? {
        id: user.id ?? String(user._id ?? ""),
        email: user.email ?? null,
        name: user.name ?? null,
        image: user.image ?? null,
      }
    : null;
}

// better-auth stores `member.userId` as the string form of the user document's
// `_id`, and the user docs have no separate `id` field — so match on both.
function userIdLookup(userIds: string[]) {
  const objectIds = userIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  return { $or: [{ id: { $in: userIds } }, { _id: { $in: objectIds } }] };
}

function userAuthId(user: UserRecord): string {
  return user.id || String(user._id ?? "");
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;

    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin", "member"],
    });

    await dbConnect();
    const members = await mongoose.connection
      .collection<OrgMemberRecord>("member")
      .find({ organizationId: orgId })
      .sort({ createdAt: 1 })
      .toArray();
    const userIds = members.map((member) => member.userId);
    const users = userIds.length
      ? await mongoose.connection
          .collection<UserRecord>("user")
          .find(userIdLookup(userIds))
          .project({ id: 1, email: 1, name: 1, image: 1 })
          .toArray()
      : [];
    const userById = new Map(users.map((user) => [userAuthId(user), user]));

    return NextResponse.json({
      members: members.map((member) => ({
        id: member.id ?? null,
        organizationId: member.organizationId,
        userId: member.userId,
        role: member.role ?? "member",
        createdAt: member.createdAt ?? null,
        user: serializeUser(userById.get(member.userId)),
      })),
    });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to list members";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
