import { redirect } from "next/navigation";
import { OrgFilesClient } from "@/components/organizations/OrgFilesClient";
import { OrganizationWorkspaceShell } from "@/components/organizations/OrganizationWorkspaceShell";
import { requireAuth } from "@/lib/auth/session";
import { assertOrgMember } from "@/lib/orgs/access";

interface PageProps {
  params: Promise<{ orgId: string }>;
}

export default async function OrganizationFilesPage({ params }: PageProps) {
  const session = await requireAuth();
  const { orgId } = await params;

  let membership;
  try {
    membership = await assertOrgMember({ userId: session.user.id, orgId });
  } catch {
    redirect("/organizations");
  }

  return (
    <OrganizationWorkspaceShell
      user={session.user}
      org={{
        id: orgId,
        name: membership.organization.name,
        role: membership.role,
      }}
      title={`${membership.organization.name} files`}
      description="Organization-owned encrypted buckets and files."
    >
      <OrgFilesClient orgId={orgId} orgName={membership.organization.name} />
    </OrganizationWorkspaceShell>
  );
}
