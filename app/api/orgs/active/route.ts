import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import {
  AuthzError,
  isAuthzError,
  requireAccessContext,
  toJsonResponse,
} from "@/lib/authz";
import dbConnect from "@/lib/mongodb";
import {
  assertOrgMember,
  assertOrganizationsEnabled,
} from "@/lib/orgs/access";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccessContext(request);
    assertOrganizationsEnabled();
    const body = await request.json().catch(() => ({}));
    const orgId =
      typeof body.orgId === "string" && body.orgId.trim()
        ? body.orgId.trim()
        : null;

    if (orgId) {
      await assertOrgMember({ userId: ctx.userId, orgId });
    }

    await dbConnect();
    const sessionId = ctx.session.session.id;
    const result = await mongoose.connection.collection("session").updateOne(
      { id: sessionId, userId: ctx.userId },
      orgId
        ? {
            $set: {
              activeOrganizationId: orgId,
              updatedAt: new Date(),
            },
            $unset: { activeTeamId: "" },
          }
        : {
            $unset: {
              activeOrganizationId: "",
              activeTeamId: "",
            },
            $set: { updatedAt: new Date() },
          },
    );

    if (result.matchedCount === 0) {
      throw new AuthzError(404, "session_not_found", "Session not found");
    }

    return NextResponse.json({
      activeOrganizationId: orgId,
      scope: orgId ? "organization" : "personal",
    });
  } catch (error) {
    if (isAuthzError(error)) {
      return toJsonResponse(error);
    }
    const message =
      error instanceof Error ? error.message : "Failed to switch organization";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
