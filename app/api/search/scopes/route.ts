import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { listUserOrgs } from "@/lib/orgs/listUserOrgs";

export const dynamic = "force-dynamic";

/**
 * GET /api/search/scopes — the workspaces the caller can search across.
 *
 * Backs the global-search scope selector (Current workspace vs a specific
 * workspace / All). Actual matching stays client-side over each workspace's
 * local encrypted index (E2EE): the server only enumerates the scopes; it never
 * sees plaintext file names. Cross-workspace indexing is a client follow-up.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const activeOrgId =
      (session.session as { activeOrganizationId?: string | null })
        .activeOrganizationId ?? null;
    const orgs = await listUserOrgs(session.user.id, activeOrgId);

    return NextResponse.json({
      scopes: [
        { id: "personal", type: "personal", label: "Personal", active: !activeOrgId },
        ...orgs.map((org) => ({
          id: org.id,
          type: "organization" as const,
          label: org.name,
          active: org.isActive,
        })),
      ],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load search scopes";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
