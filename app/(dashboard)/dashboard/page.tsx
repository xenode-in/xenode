import { requireAuth } from "@/lib/auth/session";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { OrgHome } from "@/components/dashboard/OrgHome";
import { isOrganizationFeatureEnabled, type OrgRole } from "@/lib/auth/organization";
import { assertOrgMember } from "@/lib/orgs/access";
import { getOrgHomeSummary, type OrgHomeSummary } from "@/lib/orgs/home";

export default async function DashboardPage() {
  const session = await requireAuth();

  const activeOrgId =
    (session.session as { activeOrganizationId?: string | null })
      .activeOrganizationId ?? null;

  // Resolve the active org workspace, falling back to personal if the active org
  // is stale (membership revoked) or the feature is disabled.
  let activeOrg: { name: string; role: OrgRole } | null = null;
  let summary: OrgHomeSummary | null = null;
  if (activeOrgId && isOrganizationFeatureEnabled()) {
    try {
      const membership = await assertOrgMember({
        userId: session.user.id,
        orgId: activeOrgId,
      });
      activeOrg = { name: membership.organization.name, role: membership.role };
      summary = await getOrgHomeSummary({ orgId: activeOrgId });
    } catch {
      activeOrg = null;
    }
  }

  if (activeOrg && summary) {
    return (
      <OrgHome
        orgName={activeOrg.name}
        role={activeOrg.role}
        isAdmin={activeOrg.role === "owner" || activeOrg.role === "admin"}
        summary={summary}
      />
    );
  }

  return <DashboardClient />;
}
