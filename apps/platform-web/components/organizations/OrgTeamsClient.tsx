"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Layers,
  Loader2,
  Plus,
  Trash2,
  UserPlus,
  UserMinus,
  Pencil,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";
import { useCrypto } from "@/contexts/CryptoContext";
import { useSession } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { OrgFilesClient } from "@/components/organizations/OrgFilesClient";
import {
  generateOrgSpaceKey,
  unwrapSpaceKeyGrant,
  wrapSpaceKeyForCryptoKey,
  wrapSpaceKeyForPublicKey,
} from "@/lib/orgs/spaceKeyClient";
import type { OrgRole } from "@/lib/auth/organization";

interface Team {
  id: string;
  name: string;
  createdAt: string | null;
  memberCount: number;
  isMember: boolean;
}

interface TeamMember {
  userId: string;
  user: { email: string | null; name: string | null; image: string | null } | null;
}

interface RecipientLookup {
  userId: string;
  email: string;
  publicKey: string;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  }
  return data as T;
}

export function OrgTeamsClient({
  orgId,
  orgName,
  role,
}: {
  orgId: string;
  orgName: string;
  role: OrgRole;
}) {
  const { privateKey, publicKey, isUnlocked, setModalOpen } = useCrypto();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? "";

  const canManageTeams = role === "owner" || role === "admin";
  const canManageMembers = role === "owner" || role === "admin";

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [openTeam, setOpenTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");

  const loadTeams = useCallback(async () => {
    const data = await readJson<{ teams: Team[] }>(
      await fetch(`/api/orgs/${orgId}/teams`),
    );
    setTeams(data.teams);
  }, [orgId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await loadTeams();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, [loadTeams]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMembers = useCallback(
    async (teamId: string) => {
      const data = await readJson<{ members: TeamMember[] }>(
        await fetch(`/api/orgs/${orgId}/teams/${teamId}/members`),
      );
      setMembers(data.members);
    },
    [orgId],
  );

  useEffect(() => {
    if (openTeam) void loadMembers(openTeam.id).catch(() => setMembers([]));
  }, [openTeam, loadMembers]);

  const loadRawTeamKey = useCallback(
    async (teamId: string): Promise<{ rawSpaceKey: Uint8Array; keyVersion: number }> => {
      if (!privateKey) {
        setModalOpen(true);
        throw new Error("Unlock your vault first");
      }
      const data = await readJson<{ keys: { wrappedKey: string; keyVersion: number }[] }>(
        await fetch(`/api/orgs/${orgId}/keys?teamId=${teamId}`),
      );
      const grant = data.keys[0];
      if (!grant) throw new Error("Your team space key is not available");
      return {
        rawSpaceKey: await unwrapSpaceKeyGrant({
          wrappedSpaceKey: grant.wrappedKey,
          privateKey,
        }),
        keyVersion: grant.keyVersion,
      };
    },
    [orgId, privateKey, setModalOpen],
  );

  const createTeam = async () => {
    const name = teamName.trim();
    if (!name) {
      toast.error("Team name is required");
      return;
    }
    if (!isUnlocked || !publicKey) {
      setModalOpen(true);
      toast.error("Unlock your vault before creating a team");
      return;
    }
    setBusy("create");
    try {
      const rawSpaceKey = generateOrgSpaceKey();
      const ownerWrappedTeamKey = await wrapSpaceKeyForCryptoKey({ rawSpaceKey, publicKey });
      await readJson(
        await fetch(`/api/orgs/${orgId}/teams`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, ownerWrappedTeamKey, keyVersion: 1 }),
        }),
      );
      setTeamName("");
      toast.success("Team created");
      await loadTeams();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create team");
    } finally {
      setBusy(null);
    }
  };

  const renameTeam = async (team: Team) => {
    const name = window.prompt("Rename team", team.name)?.trim();
    if (!name || name === team.name) return;
    setBusy(`rename-${team.id}`);
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}/teams/${team.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }),
      );
      toast.success("Team renamed");
      await loadTeams();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename team");
    } finally {
      setBusy(null);
    }
  };

  const deleteTeam = async (team: Team) => {
    if (!window.confirm(`Delete team "${team.name}"? All its files will be removed.`)) {
      return;
    }
    setBusy(`delete-${team.id}`);
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}/teams/${team.id}`, { method: "DELETE" }),
      );
      toast.success("Team deleted");
      if (openTeam?.id === team.id) setOpenTeam(null);
      await loadTeams();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete team");
    } finally {
      setBusy(null);
    }
  };

  const addMember = async () => {
    if (!openTeam) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      toast.error("Email is required");
      return;
    }
    setBusy("add-member");
    try {
      const lookup = await readJson<{
        recipients: RecipientLookup[];
        unavailable: Array<{ email: string; reason: string }>;
      }>(
        await fetch("/api/orgs/recipients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: [email] }),
        }),
      );
      if (lookup.unavailable.length > 0 || lookup.recipients.length === 0) {
        throw new Error(lookup.unavailable[0]?.reason || "Recipient is not available");
      }
      const recipient = lookup.recipients[0];
      const { rawSpaceKey, keyVersion } = await loadRawTeamKey(openTeam.id);
      const wrappedTeamKey = await wrapSpaceKeyForPublicKey({
        rawSpaceKey,
        recipientPublicKey: recipient.publicKey,
      });
      await readJson(
        await fetch(`/api/orgs/${orgId}/teams/${openTeam.id}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            memberUserId: recipient.userId,
            wrappedTeamKey,
            keyVersion,
          }),
        }),
      );
      setInviteEmail("");
      toast.success("Member added to team");
      await Promise.all([loadMembers(openTeam.id), loadTeams()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add member");
    } finally {
      setBusy(null);
    }
  };

  const removeMember = async (member: TeamMember) => {
    if (!openTeam) return;
    if (member.userId === currentUserId) {
      toast.error("Self-removal is not available here");
      return;
    }
    const label = member.user?.email || member.userId;
    if (!window.confirm(`Remove ${label} from ${openTeam.name}?`)) return;
    if (!publicKey) {
      setModalOpen(true);
      toast.error("Unlock your vault before rotating team keys");
      return;
    }
    setBusy(`remove-${member.userId}`);
    try {
      const { keyVersion } = await loadRawTeamKey(openTeam.id);
      const nextKeyVersion = keyVersion + 1;
      const nextSpaceKey = generateOrgSpaceKey();
      const remaining = members.filter((m) => m.userId !== member.userId);
      const others = remaining.filter((m) => m.userId !== currentUserId);
      const otherEmails = others.map((m) => m.user?.email);
      if (otherEmails.some((e) => !e)) {
        throw new Error("Every remaining member needs an email before rotation");
      }
      const lookup = otherEmails.length
        ? await readJson<{
            recipients: RecipientLookup[];
            unavailable: Array<{ email: string; reason: string }>;
          }>(
            await fetch("/api/orgs/recipients", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ emails: otherEmails }),
            }),
          )
        : { recipients: [], unavailable: [] };
      if (lookup.unavailable.length > 0) {
        throw new Error(
          lookup.unavailable.map((i) => `${i.email}: ${i.reason}`).join(" | "),
        );
      }
      const byUserId = new Map(lookup.recipients.map((r) => [r.userId, r]));
      const rotationGrants = await Promise.all(
        remaining.map(async (m) => {
          const wrappedSpaceKey =
            m.userId === currentUserId
              ? await wrapSpaceKeyForCryptoKey({ rawSpaceKey: nextSpaceKey, publicKey })
              : await wrapSpaceKeyForPublicKey({
                  rawSpaceKey: nextSpaceKey,
                  recipientPublicKey: byUserId.get(m.userId)?.publicKey || "",
                });
          if (!wrappedSpaceKey) throw new Error("Failed to prepare a rotation grant");
          return { memberUserId: m.userId, wrappedSpaceKey, keyVersion: nextKeyVersion };
        }),
      );
      await readJson(
        await fetch(`/api/orgs/${orgId}/teams/${openTeam.id}/members/${member.userId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rotationGrants }),
        }),
      );
      toast.success("Member removed");
      await Promise.all([loadMembers(openTeam.id), loadTeams()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove member");
    } finally {
      setBusy(null);
    }
  };

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name)),
    [teams],
  );

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Team drive view ─────────────────────────────────────────────────────────
  if (openTeam) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpenTeam(null)}>
              <ArrowLeft className="h-4 w-4" />
              Teams
            </Button>
            <span className="text-lg font-semibold text-foreground">{openTeam.name}</span>
            <Badge variant="secondary">{members.length} members</Badge>
          </div>
        </div>

        {canManageMembers && (
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-medium">Team members</h2>
            <div className="mb-4 flex gap-2">
              <Input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
              />
              <Button onClick={addMember} disabled={busy !== null}>
                {busy === "add-member" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                Add
              </Button>
            </div>
            <ul className="divide-y divide-border/60">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between py-2">
                  <span className="truncate text-sm text-foreground/80">
                    {m.user?.email || m.user?.name || m.userId}
                    {m.userId === currentUserId && (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    )}
                  </span>
                  {m.userId !== currentUserId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMember(m)}
                      disabled={busy !== null}
                      className="text-destructive hover:bg-destructive/10"
                    >
                      {busy === `remove-${m.userId}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <UserMinus className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <OrgFilesClient
          orgId={orgId}
          orgName={openTeam.name}
          teamId={openTeam.id}
          role={role}
        />
      </div>
    );
  }

  // ── Teams list view ─────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Team Spaces</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Encrypted team drives inside {orgName}. Each team has its own space key.
        </p>
      </div>

      {canManageTeams && (
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-medium">Create a team</h2>
          </div>
          <div className="flex gap-2">
            <Input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Engineering"
            />
            <Button onClick={createTeam} disabled={busy !== null}>
              {busy === "create" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Layers className="h-4 w-4" />
              )}
              Create
            </Button>
          </div>
        </section>
      )}

      {sortedTeams.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <Layers className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No teams yet.</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {sortedTeams.map((team) => (
            <li
              key={team.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary/10 text-sidebar-primary">
                    <Layers className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{team.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {team.memberCount} member{team.memberCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                {canManageTeams && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => renameTeam(team)}
                      disabled={busy !== null}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:bg-destructive/10"
                      onClick={() => deleteTeam(team)}
                      disabled={busy !== null}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setOpenTeam(team)}
                disabled={!team.isMember}
              >
                <FolderOpen className="h-4 w-4" />
                {team.isMember ? "Open drive" : "Not a member"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
