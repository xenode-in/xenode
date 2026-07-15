import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  FolderOpen,
  BarChart3,
  CreditCard,
  Settings,
  Share2,
  Users,
  CloudDownload,
  LifeBuoy,
  Trash2,
  Star,
  Building2,
  Home,
  Inbox,
  Contact,
  Clock,
  Activity,
  GitPullRequest,
  UserCog,
  ShieldCheck,
  ScrollText,
  Webhook,
} from "lucide-react";

export type WorkspaceKind = "personal" | "organization";
export type OrgRole = "owner" | "admin" | "member" | "guest";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Org-only gating. Omit ⇒ visible to every org role. Ignored for personal. */
  roles?: OrgRole[];
}

/** The workspace the shell is currently rendering. */
export interface WorkspaceNav {
  kind: WorkspaceKind;
  /** Present only when kind === "organization". */
  role?: OrgRole;
  orgId?: string;
  orgName?: string;
}

/** Personal workspace nav — unchanged from the original dashboard sidebar. */
export const PERSONAL_NAV: NavItem[] = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "My Files", href: "/dashboard/files", icon: FolderOpen },
  { label: "Migrations (Beta)", href: "/dashboard/migrations", icon: CloudDownload },
  { label: "Shared", href: "/dashboard/shared", icon: Share2 },
  { label: "Shared with me", href: "/dashboard/shared-with-me", icon: Users },
  { label: "Organizations", href: "/organizations", icon: Building2 },
  { label: "Starred", href: "/dashboard/starred", icon: Star },
  { label: "Bin", href: "/dashboard/bin", icon: Trash2 },
  { label: "Usage", href: "/dashboard/usage", icon: BarChart3 },
  { label: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { label: "Support", href: "/dashboard/support", icon: LifeBuoy },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

const MEMBERS: OrgRole[] = ["owner", "admin", "member"];
const ADMINS: OrgRole[] = ["owner", "admin"];

/**
 * One ordered org superset. Filtering by role yields each product sidebar
 * (admin / member / guest). Home and Settings are visible to everyone; the
 * collaboration items are member-tier; the governance items are admin-tier;
 * guests get the explicitly-shared surface only.
 */
export const ORG_NAV: NavItem[] = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "My Files", href: "/dashboard/org/files", icon: FolderOpen, roles: MEMBERS },
  { label: "Team Spaces", href: "/dashboard/org/team-spaces", icon: Users, roles: MEMBERS },
  { label: "Shared", href: "/dashboard/org/shared", icon: Share2, roles: MEMBERS },
  { label: "Shared With Me", href: "/dashboard/org/shared-with-me", icon: Inbox, roles: ["guest"] },
  { label: "People", href: "/dashboard/org/people", icon: Contact },
  { label: "Recent", href: "/dashboard/org/recent", icon: Clock, roles: MEMBERS },
  { label: "Favorites", href: "/dashboard/org/favorites", icon: Star, roles: MEMBERS },
  { label: "Activity", href: "/dashboard/org/activity", icon: Activity },
  { label: "Requests", href: "/dashboard/org/requests", icon: GitPullRequest },
  { label: "Users", href: "/dashboard/org/users", icon: UserCog, roles: ADMINS },
  // Team management lives under "Team Spaces" (create/rename/delete + members) —
  // no separate admin "Teams" item to avoid a duplicate destination.
  { label: "Analytics", href: "/dashboard/org/analytics", icon: BarChart3, roles: ADMINS },
  { label: "Security", href: "/dashboard/org/security", icon: ShieldCheck, roles: ADMINS },
  { label: "Audit Logs", href: "/dashboard/org/audit", icon: ScrollText, roles: ADMINS },
  { label: "Integrations", href: "/dashboard/org/integrations", icon: Webhook, roles: ADMINS },
  { label: "Bin", href: "/dashboard/org/bin", icon: Trash2, roles: MEMBERS },
  { label: "Billing", href: "/dashboard/org/billing", icon: CreditCard, roles: ADMINS },
  { label: "Settings", href: "/dashboard/org/settings", icon: Settings },
];

/** Sidebar items for the active workspace + role. */
export function getSidebarNav(workspace: WorkspaceNav): NavItem[] {
  if (workspace.kind === "personal") return PERSONAL_NAV;
  const role = workspace.role ?? "member";
  return ORG_NAV.filter((item) => !item.roles || item.roles.includes(role));
}
