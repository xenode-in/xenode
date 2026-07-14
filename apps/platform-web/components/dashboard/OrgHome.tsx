import Link from "next/link";
import {
  Upload,
  Clock,
  Activity,
  GitPullRequest,
  HardDrive,
  Users,
  ArrowRight,
  UserCheck,
  FolderOpen,
} from "lucide-react";
import { StorageChart } from "@/components/dashboard/StorageChart";
import { OrgStatTile, OrgSectionCard, OrgEmptyState } from "@/components/organizations/org-ui";
import { formatBytes, formatDate } from "@/lib/utils";
import type { OrgRole } from "@/lib/auth/organization";
import type { OrgHomeSummary } from "@/lib/orgs/home";

interface OrgHomeProps {
  orgName: string;
  role: OrgRole;
  isAdmin: boolean;
  summary: OrgHomeSummary;
}

function prettyAction(action: string): string {
  const label = action.replace(/[._]/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Organization Home — the workspace landing surface, wired to live data
 * (storage, seats, members, pending requests, recent activity/files). Cards
 * keep helpful CTAs so the screen is never empty.
 */
export function OrgHome({ orgName, role, isAdmin, summary }: OrgHomeProps) {
  const { storage, seats, memberCount, pendingRequests, fileCount } = summary;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Hero */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-gradient-to-br from-sidebar-primary/10 via-card to-card p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Organization workspace
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">{orgName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You&rsquo;re working here as{" "}
            <span className="font-medium capitalize text-foreground/80">{role}</span>.
          </p>
        </div>
        {role !== "guest" && (
          <Link
            href="/dashboard/org/files"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Upload className="h-4 w-4" />
            Upload files
          </Link>
        )}
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <OrgStatTile
          icon={HardDrive}
          label="Storage used"
          value={formatBytes(storage.usedBytes)}
          hint={storage.limitBytes === null ? "Unlimited" : `of ${formatBytes(storage.limitBytes)}`}
        />
        <OrgStatTile icon={FolderOpen} label="Files" value={fileCount} />
        <OrgStatTile
          icon={UserCheck}
          label="Seats"
          value={`${seats.used}/${seats.total}`}
          hint="members using a seat"
        />
        <OrgStatTile icon={Users} label="People" value={memberCount} />
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <OrgSectionCard
          title="Storage usage"
          icon={HardDrive}
          action={
            <Link href="/dashboard/org/files" className="text-xs font-medium text-primary hover:underline">
              Manage
            </Link>
          }
        >
          <StorageChart usedBytes={storage.usedBytes} totalBytes={storage.limitBytes} />
        </OrgSectionCard>

        <OrgSectionCard
          title="Recent activity"
          icon={Activity}
          action={
            <Link href="/dashboard/org/activity" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              View feed <ArrowRight className="h-3 w-3" />
            </Link>
          }
        >
          {summary.recentActivity.length === 0 ? (
            <OrgEmptyState icon={Activity} title="No activity yet" compact />
          ) : (
            <ul className="space-y-2.5">
              {summary.recentActivity.map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                  <div className="min-w-0">
                    <p className="truncate text-foreground">{prettyAction(a.action)}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(a.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </OrgSectionCard>

        <OrgSectionCard
          title="Pending requests"
          icon={GitPullRequest}
          action={
            <Link href="/dashboard/org/requests" className="text-xs font-medium text-primary hover:underline">
              Review
            </Link>
          }
        >
          {pendingRequests === 0 ? (
            <OrgEmptyState icon={GitPullRequest} title="No pending requests" compact />
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <p className="text-4xl font-semibold text-foreground">{pendingRequests}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isAdmin ? "awaiting your review" : "awaiting review"}
              </p>
            </div>
          )}
        </OrgSectionCard>

        <OrgSectionCard
          title="Continue working"
          icon={Clock}
          action={
            <Link href="/dashboard/org/files" className="text-xs font-medium text-primary hover:underline">
              Open files
            </Link>
          }
        >
          {summary.recentFiles.length === 0 ? (
            <OrgEmptyState icon={FolderOpen} title="No files yet" description="Upload to get started." compact />
          ) : (
            <ul className="space-y-2 text-sm">
              {summary.recentFiles.map((f) => (
                <li key={f.id} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-foreground/80">
                    <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    Encrypted file
                  </span>
                  <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                </li>
              ))}
            </ul>
          )}
        </OrgSectionCard>

        <OrgSectionCard
          title="People"
          icon={Users}
          action={
            <Link href="/dashboard/org/people" className="text-xs font-medium text-primary hover:underline">
              Directory
            </Link>
          }
        >
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <p className="text-4xl font-semibold text-foreground">{memberCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">members in this organization</p>
          </div>
        </OrgSectionCard>

        <OrgSectionCard title="Team spaces" icon={Users} action={
          <Link href="/dashboard/org/team-spaces" className="text-xs font-medium text-primary hover:underline">
            Open
          </Link>
        }>
          <OrgEmptyState
            icon={Users}
            title="Collaborate in teams"
            description="Create encrypted team drives for focused groups."
            compact
          />
        </OrgSectionCard>
      </div>
    </div>
  );
}
