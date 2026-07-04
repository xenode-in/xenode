import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/session";
import { isOrganizationFeatureEnabled } from "@/lib/auth/organization";
import { assertOrgMember } from "@/lib/orgs/access";
import { OrgFilesClient } from "@/components/organizations/OrgFilesClient";
import { OrgActivityFeed } from "@/components/organizations/OrgActivityFeed";
import { OrgComingSoon } from "@/components/dashboard/OrgComingSoon";

interface PageProps {
  params: Promise<{ section: string }>;
}

const SECTION_META: Record<string, { title: string; description: string }> = {
  "team-spaces": {
    title: "Team Spaces",
    description: "Shared team drives are coming soon (Phase 4).",
  },
  shared: {
    title: "Shared",
    description: "Files shared within this organization will appear here.",
  },
  "shared-with-me": {
    title: "Shared With Me",
    description: "Resources explicitly shared with you will appear here.",
  },
  people: {
    title: "People",
    description: "Your teammates and their roles will appear here.",
  },
  recent: {
    title: "Recent",
    description: "Recently accessed organization files will appear here.",
  },
  favorites: {
    title: "Favorites",
    description: "Files you star in this organization will appear here.",
  },
  activity: {
    title: "Activity",
    description: "The organization activity feed is coming soon (Phase 3).",
  },
  requests: {
    title: "Requests",
    description: "Access requests are coming soon (Phase 6).",
  },
  users: {
    title: "Users",
    description: "Manage members and roles — coming soon. Use Manage organizations for now.",
  },
  teams: {
    title: "Teams",
    description: "Team management is coming soon (Phase 4).",
  },
  analytics: {
    title: "Analytics",
    description: "Organization analytics are coming soon.",
  },
  security: {
    title: "Security",
    description: "Security controls are coming soon.",
  },
  audit: {
    title: "Audit Logs",
    description: "Immutable audit logs are coming soon (Phase 3).",
  },
  integrations: {
    title: "Integrations",
    description: "Integrations are coming soon.",
  },
  bin: {
    title: "Bin",
    description: "Deleted organization files will appear here.",
  },
  billing: {
    title: "Billing",
    description: "Organization billing & seats are coming soon (Phase 2).",
  },
  settings: {
    title: "Settings",
    description: "Organization settings — manage domains and more from Manage organizations for now.",
  },
};

export default async function OrgSectionPage({ params }: PageProps) {
  const session = await requireAuth();
  const { section } = await params;

  const activeOrgId =
    (session.session as { activeOrganizationId?: string | null })
      .activeOrganizationId ?? null;

  if (!activeOrgId || !isOrganizationFeatureEnabled()) {
    redirect("/dashboard");
  }

  let membership;
  try {
    membership = await assertOrgMember({
      userId: session.user.id,
      orgId: activeOrgId,
    });
  } catch {
    redirect("/dashboard");
  }

  // Files: the one functional org section in Phase 1. Guests hold no space key,
  // so the file browser isn't usable for them — send them Home.
  if (section === "files") {
    if (membership.role === "guest") {
      redirect("/dashboard");
    }
    return (
      <OrgFilesClient
        orgId={activeOrgId}
        orgName={membership.organization.name}
      />
    );
  }

  // Activity feed (all non-guest members) and Audit Logs (admin nav entry) share
  // the same feed component; the API enforces the non-guest gate.
  if (section === "activity" || section === "audit") {
    return <OrgActivityFeed orgId={activeOrgId} />;
  }

  const meta = SECTION_META[section] ?? {
    title: "Coming soon",
    description: "This area is coming soon as the organization workspace rolls out.",
  };
  return <OrgComingSoon title={meta.title} description={meta.description} />;
}
