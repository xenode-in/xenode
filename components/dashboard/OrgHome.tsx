import Link from "next/link";
import {
  Upload,
  FolderOpen,
  Clock,
  Activity,
  GitPullRequest,
  HardDrive,
  Megaphone,
  Users,
  ArrowRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { OrgRole } from "@/lib/navigation/sidebar-nav";

interface OrgHomeProps {
  orgName: string;
  role: OrgRole;
  isAdmin: boolean;
}

function SectionCard({
  title,
  icon: Icon,
  href,
  action,
  children,
}: {
  title: string;
  icon: LucideIcon;
  href?: string;
  action?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        </div>
        {href && action && (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {action}
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-[72px] items-center justify-center rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}

/**
 * Organization Home — the never-empty landing surface for an org workspace.
 * Phase 1 ships the layout with helpful empty states + CTAs; later phases wire
 * the live data (recent files, activity, requests, usage).
 */
export function OrgHome({ orgName, role, isAdmin }: OrgHomeProps) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Hero */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-gradient-to-br from-sidebar-primary/10 via-card to-card p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Organization workspace
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">
            {orgName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You&rsquo;re working here as{" "}
            <span className="font-medium capitalize text-foreground/80">
              {role}
            </span>
            .
          </p>
        </div>
        <Link
          href="/dashboard/org/files"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Upload className="h-4 w-4" />
          Upload files
        </Link>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <SectionCard
          title="Continue working"
          icon={FolderOpen}
          href="/dashboard/org/files"
          action="Open files"
        >
          <EmptyHint text="Your recently opened files will appear here." />
        </SectionCard>

        <SectionCard
          title="Recent files"
          icon={Clock}
          href="/dashboard/org/files"
          action="View all"
        >
          <EmptyHint text="No files yet — upload to get started." />
        </SectionCard>

        <SectionCard
          title="Storage usage"
          icon={HardDrive}
          href="/dashboard/org/files"
          action="Details"
        >
          <EmptyHint text="Organization storage usage will show here." />
        </SectionCard>

        <SectionCard
          title="Pending requests"
          icon={GitPullRequest}
          href="/dashboard/org/requests"
          action="Review"
        >
          <EmptyHint text="No pending access requests." />
        </SectionCard>

        <SectionCard
          title="Recent activity"
          icon={Activity}
          href="/dashboard/org/activity"
          action="View feed"
        >
          <EmptyHint text="Team activity will appear here." />
        </SectionCard>

        <SectionCard
          title={isAdmin ? "People" : "Announcements"}
          icon={isAdmin ? Users : Megaphone}
          href={isAdmin ? "/dashboard/org/people" : "/dashboard/org/activity"}
          action={isAdmin ? "Manage" : undefined}
        >
          <EmptyHint
            text={
              isAdmin
                ? "Invite teammates and manage roles."
                : "No announcements right now."
            }
          />
        </SectionCard>
      </div>
    </div>
  );
}
