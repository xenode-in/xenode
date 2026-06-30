import { redirect } from "next/navigation";
import { OrganizationWorkspaceShell } from "@/components/organizations/OrganizationWorkspaceShell";
import { OrganizationsClient } from "@/components/organizations/OrganizationsClient";
import { getServerSession } from "@/lib/auth/session";

export default async function OrganizationsPage() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <OrganizationWorkspaceShell
      user={session.user}
      title="Team workspaces"
      description="Create organizations, switch collaboration scope, and manage secure access."
    >
      <OrganizationsClient />
    </OrganizationWorkspaceShell>
  );
}
