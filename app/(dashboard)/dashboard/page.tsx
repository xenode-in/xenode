import { requireAuth } from "@/lib/auth/session";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { OrgHome } from "@/components/dashboard/OrgHome";
import { isOrganizationFeatureEnabled, type OrgRole } from "@/lib/auth/organization";
import { assertOrgMember } from "@/lib/orgs/access";

export default async function DashboardPage() {
  const session = await requireAuth();

  const activeOrgId =
    (session.session as { activeOrganizationId?: string | null })
      .activeOrganizationId ?? null;

  // Resolve the active org workspace, falling back to personal if the active org
  // is stale (membership revoked) or the feature is disabled.
  let activeOrg: { name: string; role: OrgRole } | null = null;
  if (activeOrgId && isOrganizationFeatureEnabled()) {
    try {
      const membership = await assertOrgMember({
        userId: session.user.id,
        orgId: activeOrgId,
      });
      activeOrg = { name: membership.organization.name, role: membership.role };
    } catch {
      activeOrg = null;
    }
  }

  if (activeOrg) {
    return (
      <OrgHome
        orgName={activeOrg.name}
        role={activeOrg.role}
        isAdmin={activeOrg.role === "owner" || activeOrg.role === "admin"}
      />
    );
  }

  return <DashboardClient />;
}
