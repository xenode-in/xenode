import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { isOrganizationFeatureEnabled } from "@/lib/auth/organization";
import { assertOrgMember } from "@/lib/orgs/access";
import { OpenOrganization } from "@/components/organizations/OpenOrganization";

export default async function OrgDashboardIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string | string[] }>;
}) {
  const session = await requirePageSession();
  const activeOrgId =
    (session.session as { activeOrganizationId?: string | null })
      .activeOrganizationId ?? null;

  // `?org=` (from Accounts) opens that organization, switching to it first.
  const { org } = await searchParams;
  if (typeof org === "string" && org && org !== activeOrgId && isOrganizationFeatureEnabled()) {
    try {
      await assertOrgMember({ userId: session.user.id, orgId: org });
    } catch {
      redirect("/dashboard");
    }
    return <OpenOrganization orgId={org} />;
  }

  if (!activeOrgId || !isOrganizationFeatureEnabled()) {
    redirect("/dashboard");
  }

  try {
    await assertOrgMember({
      userId: session.user.id,
      orgId: activeOrgId,
    });
  } catch {
    redirect("/dashboard");
  }

  redirect("/dashboard/org/files");
}
