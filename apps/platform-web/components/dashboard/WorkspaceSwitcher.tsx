"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronsUpDown,
  Loader2,
  Plus,
  Settings2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { OrgRole } from "@/lib/navigation/sidebar-nav";

export interface SwitcherOrg {
  id: string;
  name: string;
  role: OrgRole;
}

interface WorkspaceSwitcherProps {
  orgs: SwitcherOrg[];
  /** null ⇒ personal workspace is active. */
  activeOrgId: string | null;
}

function roleLabel(role: OrgRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function initials(name: string): string {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "W"
  );
}

export function WorkspaceSwitcher({ orgs, activeOrgId }: WorkspaceSwitcherProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? null;
  const currentLabel = activeOrg ? activeOrg.name : "Personal";

  async function switchTo(orgId: string | null) {
    if (orgId === activeOrgId || busy) {
      setOpen(false);
      return;
    }
    setBusy(orgId ?? "personal");
    try {
      const res = await fetch("/api/orgs/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to switch workspace");
      }
      setOpen(false);
      router.push(orgId ? "/dashboard/org/files" : "/dashboard");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to switch workspace",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent"
          aria-label="Switch workspace"
        >
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
              activeOrg
                ? "bg-sidebar-primary/15 text-sidebar-primary"
                : "bg-sidebar-primary/15 text-sidebar-primary",
            )}
          >
            {activeOrg ? (
              initials(activeOrg.name)
            ) : (
              <User className="h-4 w-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-sidebar-foreground">
              {currentLabel}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {activeOrg ? roleLabel(activeOrg.role) : "Personal workspace"}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[244px] bg-card text-foreground"
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>

        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void switchTo(null);
          }}
          className="cursor-pointer gap-2"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <User className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1 truncate">Personal</span>
          {busy === "personal" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : !activeOrgId ? (
            <Check className="h-4 w-4 text-primary" />
          ) : null}
        </DropdownMenuItem>

        {orgs.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {orgs.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onSelect={(e) => {
                  e.preventDefault();
                  void switchTo(org.id);
                }}
                className="cursor-pointer gap-2"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-sidebar-primary/10 text-sidebar-primary text-[11px] font-semibold">
                  {initials(org.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{org.name}</span>
                </span>
                <Badge
                  variant="secondary"
                  className="px-1.5 py-0 text-[10px] font-normal"
                >
                  {roleLabel(org.role)}
                </Badge>
                {busy === org.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : org.id === activeOrgId ? (
                  <Check className="h-4 w-4 text-primary" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer gap-2">
          <Link href="/organizations">
            <Settings2 className="h-4 w-4" />
            Manage organizations
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer gap-2">
          <Link href="/organizations">
            <Plus className="h-4 w-4" />
            Create organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
