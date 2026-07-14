"use client";

import { useCallback, useEffect, useState } from "react";
import { Users, ShieldCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  OrgPageHeader,
  OrgLoading,
  OrgEmptyState,
} from "@/components/organizations/org-ui";
import { formatDate } from "@/lib/utils";
import type { OrgRole } from "@/lib/auth/organization";

interface Member {
  userId: string;
  role: OrgRole;
  createdAt: string | null;
  user: { email: string | null; name: string | null; image: string | null } | null;
}

function initials(m: Member): string {
  const s = m.user?.name || m.user?.email || m.userId;
  return s.slice(0, 2).toUpperCase();
}

/** Read-only member directory, visible to all non-guest members. */
export function OrgPeopleClient({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [restricted, setRestricted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/members`);
      if (res.status === 403) {
        setRestricted(true);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <OrgLoading />;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <OrgPageHeader title="People" description="Everyone in this organization." />

      {restricted ? (
        <OrgEmptyState
          icon={ShieldCheck}
          title="Limited access"
          description="The member directory isn't available for your role."
        />
      ) : members.length === 0 ? (
        <OrgEmptyState icon={Users} title="No members yet" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
            >
              <Avatar className="h-10 w-10">
                <AvatarImage src={m.user?.image ?? undefined} />
                <AvatarFallback className="bg-primary/15 text-primary text-sm">
                  {initials(m)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {m.user?.name || m.user?.email || m.userId}
                </p>
                {m.user?.email && (
                  <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>
                )}
                {m.createdAt && (
                  <p className="text-[11px] text-muted-foreground/70">
                    Joined {formatDate(m.createdAt)}
                  </p>
                )}
              </div>
              <Badge variant="secondary" className="capitalize">{m.role}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
