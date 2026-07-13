import { type NextRequest } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import {
  isOrganizationFeatureEnabled,
  normalizeOrgRole,
  type OrgRole,
} from "@/lib/auth/organization";
import { AuthzError } from "./errors";

/**
 * The tenancy scope a request acts within.
 *
 * Today every request is `personal` — the acting user owns their own data.
 * When Organizations ship (better-auth `organization` plugin), `organization`
 * scope is populated from the session's active org + member role. This union is
 * the single seam the rest of the app reads, so flipping orgs on is localized to
 * `getAccessContext` below + the policy filters in `./policy`.
 */
export type AccessScope =
  | { type: "personal"; userId: string }
  | { type: "organization"; userId: string; orgId: string; role: OrgRole }
  | { type: "team"; userId: string; orgId: string; teamId: string; role: OrgRole };

type BetterAuthSession = Awaited<ReturnType<typeof getServerSession>>;

export interface AccessContext {
  /** The acting user — always present, even under an organization scope. */
  userId: string;
  /** Tenancy scope. `personal` today; `organization` once the plugin is live. */
  scope: AccessScope;
  /** The underlying better-auth session (non-null). */
  session: NonNullable<BetterAuthSession>;
}

type DriveScope = AccessScope["type"];

interface OrganizationSessionFields {
  activeOrganizationId?: string | null;
  activeTeamId?: string | null;
}

interface MemberRecord {
  userId: string;
  organizationId: string;
  role?: string | null;
}

function requestedDriveScope(request?: NextRequest): DriveScope {
  if (!request) return "personal";
  const headerScope = request.headers.get("x-xenode-drive-scope");
  const queryScope = request.nextUrl.searchParams.get("scope");
  const scope = (headerScope || queryScope || "personal").toLowerCase();
  if (scope === "organization" || scope === "team") return scope;
  return "personal";
}

function requestedTeamId(request?: NextRequest): string | null {
  if (!request) return null;
  return (
    request.headers.get("x-xenode-team-id") ||
    request.nextUrl.searchParams.get("teamId")
  );
}

async function findActiveMember(args: {
  userId: string;
  organizationId: string;
}): Promise<MemberRecord | null> {
  await dbConnect();
  return mongoose.connection
    .collection<MemberRecord>("member")
    .findOne({
      userId: args.userId,
      organizationId: args.organizationId,
    });
}

async function assertTeamMembership(args: {
  userId: string;
  organizationId: string;
  teamId: string;
}): Promise<void> {
  await dbConnect();
  const [team, teamMember] = await Promise.all([
    mongoose.connection.collection("team").findOne({
      id: args.teamId,
      organizationId: args.organizationId,
    }),
    mongoose.connection.collection("teamMember").findOne({
      userId: args.userId,
      teamId: args.teamId,
    }),
  ]);

  if (!team || !teamMember) {
    throw new AuthzError(403, "team_membership_required", "Forbidden");
  }
}

/**
 * Resolve the current access context, or null if unauthenticated.
 *
 * Pass `request` in API route handlers (so the expo() mobile plugin can read its
 * custom cookie header); omit it in Server Components / Server Actions.
 *
 * ── Organizations (future) ──────────────────────────────────────────────────
 * When the better-auth `organization` plugin is enabled, read
 * `session.session.activeOrganizationId` here, look up the caller's membership
 * role, and return `{ type: "organization", userId, orgId, role }`. No route or
 * policy caller needs to change — they already consume `ctx.scope`.
 */
export async function getAccessContext(
  request?: NextRequest,
): Promise<AccessContext | null> {
  const session = await getServerSession(request);
  if (!session?.user?.id) return null;

  const userId = session.user.id;

  const scope = requestedDriveScope(request);
  if (!isOrganizationFeatureEnabled() || scope === "personal") {
    return {
      userId,
      scope: { type: "personal", userId },
      session,
    };
  }

  const sessionFields = session.session as OrganizationSessionFields;
  const orgId = sessionFields.activeOrganizationId;
  if (!orgId) {
    throw new AuthzError(403, "organization_required", "Forbidden");
  }

  const member = await findActiveMember({ userId, organizationId: orgId });
  if (!member) {
    throw new AuthzError(403, "organization_membership_required", "Forbidden");
  }

  const role = normalizeOrgRole(member.role);

  if (scope === "team") {
    const teamId = requestedTeamId(request) || sessionFields.activeTeamId;
    if (!teamId) {
      throw new AuthzError(400, "team_required", "Team required");
    }

    await assertTeamMembership({ userId, organizationId: orgId, teamId });

    return {
      userId,
      scope: { type: "team", userId, orgId, teamId, role },
      session,
    };
  }

  return {
    userId,
    scope: { type: "organization", userId, orgId, role },
    session,
  };
}

/**
 * Require an access context — throws AuthzError(401) when unauthenticated.
 *
 * The thrown error's `message` is `"Unauthorized"`, matching the legacy
 * `requireAuth` convention, so existing route catch-blocks that test
 * `error.message === "Unauthorized"` keep mapping it to a 401.
 */
export async function requireAccessContext(
  request?: NextRequest,
): Promise<AccessContext> {
  const ctx = await getAccessContext(request);
  if (!ctx) {
    throw new AuthzError(401, "unauthorized", "Unauthorized");
  }
  return ctx;
}
