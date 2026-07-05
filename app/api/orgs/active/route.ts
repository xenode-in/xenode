import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { isAuthzError, requireAccessContext, toJsonResponse } from "@/lib/authz";
import { assertOrgMember, assertOrganizationsEnabled } from "@/lib/orgs/access";
import { getAuth } from "@/lib/auth";
import dbConnect from "@/lib/mongodb";

export const dynamic = "force-dynamic";

interface SessionFields {
  id?: string | null;
  token?: string | null;
}

async function persistActiveOrganization(args: {
  session: SessionFields;
  orgId: string | null;
}) {
  await dbConnect();

  const sessions = mongoose.connection.collection("session");
  const filters: Array<Record<string, string>> = [];
  if (args.session.token) {
    filters.push({ token: args.session.token });
  }
  if (args.session.id) {
    filters.push({ id: args.session.id }, { _id: args.session.id });
  }

  const update = {
    $set: {
      activeOrganizationId: args.orgId,
      updatedAt: new Date(),
    },
    $unset: { activeTeamId: "" },
  };

  for (const filter of filters) {
    const result = await sessions.updateOne(filter, update);
    if (result.matchedCount > 0) {
      return true;
    }
  }

  return false;
}

/**
 * POST /api/orgs/active - set (or clear) the caller's active organization.
 *
 * Membership is enforced with Xenode's member collection, then the current
 * better-auth session is updated directly. This avoids better-auth's org plugin
 * re-checking membership against its own adapter path and rejecting valid
 * manually-created owner/member documents.
 */
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

    const sessionMatched = await persistActiveOrganization({
      session: ctx.session.session as SessionFields,
      orgId,
    });

    const updatedSession = await getAuth().api.getSession({
      headers: request.headers,
    });
    const persistedOrgId =
      (updatedSession?.session as { activeOrganizationId?: string | null } | null)
        ?.activeOrganizationId ?? null;
    if (!sessionMatched || persistedOrgId !== orgId) {
      return NextResponse.json(
        {
          error: "Failed to persist active organization",
          code: "active_organization_not_persisted",
        },
        { status: 500 },
      );
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
