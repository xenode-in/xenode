import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/session";
import { isOrganizationFeatureEnabled } from "@/lib/auth/organization";
import { assertOrgMember } from "@/lib/orgs/access";

export default async function OrgDashboardIndexPage() {
  const session = await requireAuth();
  const activeOrgId =
    (session.session as { activeOrganizationId?: string | null })
      .activeOrganizationId ?? null;

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
