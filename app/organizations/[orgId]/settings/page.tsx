import { redirect } from "next/navigation";
import { OrgSettingsClient } from "@/components/organizations/OrgSettingsClient";
import { OrganizationWorkspaceShell } from "@/components/organizations/OrganizationWorkspaceShell";
import { requireAuth } from "@/lib/auth/session";
import { assertOrgMember } from "@/lib/orgs/access";

interface PageProps {
  params: Promise<{ orgId: string }>;
}

export default async function OrganizationSettingsPage({ params }: PageProps) {
  const session = await requireAuth();
  const { orgId } = await params;

  let membership;
  try {
    membership = await assertOrgMember({ userId: session.user.id, orgId });
  } catch {
    redirect("/organizations");
  }

  const canAdmin = membership.role === "owner" || membership.role === "admin";

  return (
    <OrganizationWorkspaceShell
      user={session.user}
      org={{
        id: orgId,
        name: membership.organization.name,
        role: membership.role,
      }}
      title={`${membership.organization.name} settings`}
      description="Verified domains and organization workspace controls."
    >
      <OrgSettingsClient orgId={orgId} canAdmin={canAdmin} />
    </OrganizationWorkspaceShell>
  );
}
