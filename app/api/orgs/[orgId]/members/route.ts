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

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await requireAccessContext(request);
    const { orgId } = await params;

    await assertOrgMemberRole({
      userId: ctx.userId,
      orgId,
      allowed: ["owner", "admin", "manager", "member"],
    });

    await dbConnect();
    const members = await mongoose.connection
      .collection<OrgMemberRecord>("member")
      .find({ organizationId: orgId })
      .sort({ createdAt: 1 })
      .toArray();
    const userIds = members.map((member) => member.userId);
    const users = await mongoose.connection
      .collection<UserRecord>("user")
      .find({ id: { $in: userIds } })
      .project({ id: 1, email: 1, name: 1, image: 1 })
      .toArray();
    const userById = new Map(users.map((user) => [user.id, user]));

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
