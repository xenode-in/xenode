import Link from "next/link";
import { redirect } from "next/navigation";
import { Files, Settings, ShieldCheck, Users } from "lucide-react";
import { OrganizationWorkspaceShell } from "@/components/organizations/OrganizationWorkspaceShell";
import { Badge } from "@/components/ui/badge";
import { requireAuth } from "@/lib/auth/session";
import { assertOrgMember } from "@/lib/orgs/access";

interface PageProps {
  params: Promise<{ orgId: string }>;
}

export default async function OrganizationHomePage({ params }: PageProps) {
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
      description="A secure organization workspace for shared files, members, and policies."
    >
      <div className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Organization</Badge>
                <Badge variant="outline">{membership.role}</Badge>
              </div>
              <h2 className="text-2xl font-semibold text-foreground">
                {membership.organization.name}
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Use this workspace for encrypted team files, access reviews, and verified organization identity.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-xs text-muted-foreground">Storage</p>
                <p className="mt-1 text-sm font-medium">Org-scoped</p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-xs text-muted-foreground">Encryption</p>
                <p className="mt-1 text-sm font-medium">Space key</p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-xs text-muted-foreground">Identity</p>
                <p className="mt-1 text-sm font-medium">Domain ready</p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-3">
        <Link
          href={`/organizations/${orgId}/files`}
          className="rounded-xl border border-border bg-card p-6 transition-colors hover:bg-accent/50"
        >
          <Files className="mb-4 h-5 w-5 text-primary" />
          <h2 className="font-medium">Files</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Shared encrypted buckets and objects.
          </p>
        </Link>
        <Link
          href="/organizations"
          className="rounded-xl border border-border bg-card p-6 transition-colors hover:bg-accent/50"
        >
          <Users className="mb-4 h-5 w-5 text-primary" />
          <h2 className="font-medium">Members</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Invitations, roles, and removal.
          </p>
        </Link>
        <Link
          href={`/organizations/${orgId}/settings`}
          className="rounded-xl border border-border bg-card p-6 transition-colors hover:bg-accent/50"
        >
          <Settings className="mb-4 h-5 w-5 text-primary" />
          <h2 className="font-medium">Settings</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Domain verification and workspace policies.
          </p>
        </Link>
        </div>

        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-medium text-foreground">Built for collaboration</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Organization files stay under organization routes and storage ownership. Members use the shared space key instead of personal-only encryption.
              </p>
            </div>
          </div>
        </section>
      </div>
    </OrganizationWorkspaceShell>
  );
}
