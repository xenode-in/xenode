"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  UserPlus,
  Trash2,
  Crown,
  MoreHorizontal,
  MailX,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useCrypto } from "@/contexts/CryptoContext";
import { useSession } from "@/lib/auth/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OrgPageHeader, OrgSectionCard, OrgLoading } from "@/components/organizations/org-ui";
import {
  generateOrgSpaceKey,
  unwrapSpaceKeyGrant,
  wrapSpaceKeyForCryptoKey,
  wrapSpaceKeyForPublicKey,
} from "@/lib/orgs/spaceKeyClient";
import { formatDate } from "@/lib/utils";
import type { OrgRole } from "@/lib/auth/organization";

type InviteRole = "admin" | "manager" | "member" | "guest";
const ASSIGNABLE: InviteRole[] = ["admin", "manager", "member", "guest"];

interface Member {
  userId: string;
  role: OrgRole;
  createdAt: string | null;
  user: { id: string; email: string | null; name: string | null; image: string | null } | null;
}
interface Invite {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  spaceKeyReady?: boolean;
  awaitingRecipientKey?: boolean;
  recipientReadyAt?: string | null;
  previouslyMember?: boolean;
  lastRemovedAt?: string | null;
}
interface Recipient {
  userId: string;
  email: string;
  publicKey: string;
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data as T;
}

function initials(m: Member): string {
  const s = m.user?.name || m.user?.email || m.userId;
  return s.slice(0, 2).toUpperCase();
}

export function OrgUsersClient({ orgId, role }: { orgId: string; role: OrgRole }) {
  const { privateKey, publicKey, isUnlocked, setModalOpen } = useCrypto();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? "";
  const isOwner = role === "owner";

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("member");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, i] = await Promise.all([
        readJson<{ members: Member[] }>(await fetch(`/api/orgs/${orgId}/members`)),
        readJson<{ invitations: Invite[] }>(await fetch(`/api/orgs/${orgId}/invitations`)),
      ]);
      setMembers(m.members);
      setInvites(i.invitations.filter((x) => x.status === "pending"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadSpaceKey = useCallback(async () => {
    if (!privateKey) {
      setModalOpen(true);
      throw new Error("Unlock your vault first");
    }
    const data = await readJson<{ grants: { wrappedSpaceKey: string; keyVersion: number }[] }>(
      await fetch(`/api/orgs/${orgId}/keys`),
    );
    const grant = data.grants[0];
    if (!grant) throw new Error("Your organization space key is not available");
    return {
      rawSpaceKey: await unwrapSpaceKeyGrant({ wrappedSpaceKey: grant.wrappedSpaceKey, privateKey }),
      keyVersion: grant.keyVersion,
    };
  }, [orgId, privateKey, setModalOpen]);

  async function lookupRecipients(emails: string[]): Promise<Map<string, Recipient>> {
    if (emails.length === 0) return new Map();
    const data = await readJson<{ recipients: Recipient[]; unavailable: { email: string; reason: string }[] }>(
      await fetch("/api/orgs/recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      }),
    );
    if (data.unavailable.length > 0) {
      throw new Error(data.unavailable.map((u) => `${u.email}: ${u.reason}`).join(" | "));
    }
    return new Map(data.recipients.map((r) => [r.email.toLowerCase(), r]));
  }

  // Re-wrap a freshly generated space key for every remaining non-guest member
  // except the one being removed/demoted. Returns rotation grants + version.
  async function buildRotation(excludeUserId: string) {
    if (!publicKey) {
      setModalOpen(true);
      throw new Error("Unlock your vault before rotating keys");
    }
    const { keyVersion } = await loadSpaceKey();
    const nextKeyVersion = keyVersion + 1;
    const nextSpaceKey = generateOrgSpaceKey();
    const remaining = members.filter((m) => m.userId !== excludeUserId && m.role !== "guest");
    const others = remaining.filter((m) => m.userId !== currentUserId);
    const emails = others.map((m) => m.user?.email);
    if (emails.some((e) => !e)) throw new Error("Every remaining member needs an email before rotation");
    const byEmail = await lookupRecipients(emails.filter(Boolean) as string[]);
    const grants = await Promise.all(
      remaining.map(async (m) => {
        const wrappedSpaceKey =
          m.userId === currentUserId
            ? await wrapSpaceKeyForCryptoKey({ rawSpaceKey: nextSpaceKey, publicKey })
            : await wrapSpaceKeyForPublicKey({
                rawSpaceKey: nextSpaceKey,
                recipientPublicKey: byEmail.get((m.user?.email || "").toLowerCase())?.publicKey || "",
              });
        if (!wrappedSpaceKey) throw new Error("Failed to prepare a rotation grant");
        return { memberUserId: m.userId, wrappedSpaceKey, keyVersion: nextKeyVersion };
      }),
    );
    return grants;
  }

  async function invite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return toast.error("Email is required");
    setBusy("invite");
    try {
      let recipientUserId: string | null = null;
      let wrappedSpaceKey = "";
      let keyVersion = 1;
      let deferred = false;
      if (inviteRole !== "guest") {
        const data = await readJson<{
          recipients: Recipient[];
          unavailable: { email: string; reason: string }[];
        }>(
          await fetch("/api/orgs/recipients", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emails: [email] }),
          }),
        );
        const recipient = data.recipients[0];
        if (recipient) {
          // Recipient already has a vault → wrap the key now.
          if (!isUnlocked) {
            setModalOpen(true);
            throw new Error("Unlock your vault to invite encrypted members");
          }
          const { rawSpaceKey, keyVersion: v } = await loadSpaceKey();
          keyVersion = v;
          recipientUserId = recipient.userId;
          wrappedSpaceKey = await wrapSpaceKeyForPublicKey({ rawSpaceKey, recipientPublicKey: recipient.publicKey });
        } else {
          // No account / no vault yet → deferred invite; key is granted later.
          const reason = data.unavailable[0]?.reason || "";
          const deferrable = /no xenode account|encryption vault/i.test(reason);
          if (!deferrable) throw new Error(reason || "Recipient is not available");
          deferred = true;
        }
      }
      await readJson(
        await fetch(`/api/orgs/${orgId}/invitations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, role: inviteRole, recipientUserId, wrappedSpaceKey, keyVersion }),
        }),
      );
      setInviteEmail("");
      toast.success(
        deferred
          ? "Invitation emailed — they'll get access after signing up"
          : "Invitation sent",
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to invite");
    } finally {
      setBusy(null);
    }
  }

  // Grant the deferred space key to an invitee who has now set up their vault.
  async function grantAccess(inv: Invite) {
    setBusy(`grant-${inv.id}`);
    try {
      if (!privateKey) {
        setModalOpen(true);
        throw new Error("Unlock your vault to grant encrypted access");
      }
      const data = await readJson<{
        recipients: Recipient[];
        unavailable: { email: string; reason: string }[];
      }>(
        await fetch("/api/orgs/recipients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: [inv.email] }),
        }),
      );
      const recipient = data.recipients[0];
      if (!recipient) {
        throw new Error(
          data.unavailable[0]?.reason ||
            "The invitee hasn't finished setting up their vault yet",
        );
      }
      const { rawSpaceKey, keyVersion } = await loadSpaceKey();
      const wrappedSpaceKey = await wrapSpaceKeyForPublicKey({
        rawSpaceKey,
        recipientPublicKey: recipient.publicKey,
      });
      await readJson(
        await fetch(`/api/orgs/${orgId}/invitations/${inv.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wrappedSpaceKey, keyVersion }),
        }),
      );
      toast.success("Access granted — they can now join");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to grant access");
    } finally {
      setBusy(null);
    }
  }

  async function cancelInvite(id: string) {
    setBusy(`cancel-${id}`);
    try {
      await readJson(await fetch(`/api/orgs/${orgId}/invitations/${id}`, { method: "DELETE" }));
      toast.success("Invitation cancelled");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel");
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(member: Member, newRole: InviteRole) {
    if (member.role === newRole) return;
    setBusy(`role-${member.userId}`);
    try {
      const body: Record<string, unknown> = { role: newRole };
      const wasGuest = member.role === "guest";
      if (!wasGuest && newRole === "guest") {
        body.rotationGrants = await buildRotation(member.userId);
      } else if (wasGuest && newRole !== "guest") {
        const { rawSpaceKey, keyVersion } = await loadSpaceKey();
        const email = member.user?.email;
        if (!email) throw new Error("This member needs an email to gain key access");
        const byEmail = await lookupRecipients([email]);
        const recipient = byEmail.get(email.toLowerCase());
        if (!recipient) throw new Error("Member public key is unavailable");
        body.wrappedSpaceKey = await wrapSpaceKeyForPublicKey({ rawSpaceKey, recipientPublicKey: recipient.publicKey });
        body.keyVersion = keyVersion;
      }
      await readJson(
        await fetch(`/api/orgs/${orgId}/members/${member.userId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      toast.success("Role updated");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to change role");
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Remove ${member.user?.email || member.userId}?`)) return;
    setBusy(`remove-${member.userId}`);
    try {
      const body: Record<string, unknown> = {};
      if (member.role !== "guest") body.rotationGrants = await buildRotation(member.userId);
      await readJson(
        await fetch(`/api/orgs/${orgId}/members/${member.userId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      toast.success("Member removed");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove member");
    } finally {
      setBusy(null);
    }
  }

  async function transferOwnership(member: Member) {
    if (!window.confirm(`Transfer ownership to ${member.user?.email || member.userId}? You become an admin.`)) return;
    setBusy(`owner-${member.userId}`);
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}/ownership`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newOwnerUserId: member.userId }),
        }),
      );
      toast.success("Ownership transferred");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to transfer ownership");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <OrgLoading />;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <OrgPageHeader title="Users" description="Manage members, roles, and invitations." />

      <OrgSectionCard title="Invite a member" icon={UserPlus}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="teammate@company.com"
            type="email"
          />
          <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as InviteRole)}>
            <SelectTrigger className="sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ASSIGNABLE.map((r) => (
                <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={invite} disabled={busy !== null}>
            {busy === "invite" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Invite
          </Button>
        </div>
      </OrgSectionCard>

      <OrgSectionCard title={`Members (${members.length})`} icon={ShieldCheck}>
        <ul className="divide-y divide-border/60">
          {members.map((m) => {
            const isSelf = m.userId === currentUserId;
            const isMemberOwner = m.role === "owner";
            return (
              <li key={m.userId} className="flex items-center gap-3 py-3">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={m.user?.image ?? undefined} />
                  <AvatarFallback className="bg-primary/15 text-primary text-xs">{initials(m)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {m.user?.name || m.user?.email || m.userId}
                    {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                  </p>
                  {m.user?.email && <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>}
                </div>
                {isMemberOwner ? (
                  <Badge variant="secondary" className="gap-1"><Crown className="h-3 w-3" /> Owner</Badge>
                ) : (
                  <Select
                    value={m.role}
                    onValueChange={(v) => changeRole(m, v as InviteRole)}
                    disabled={busy !== null || isSelf}
                  >
                    <SelectTrigger className="h-8 w-32 capitalize">
                      {busy === `role-${m.userId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SelectValue />}
                    </SelectTrigger>
                    <SelectContent>
                      {ASSIGNABLE.map((r) => (
                        <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {!isSelf && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy !== null}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {isOwner && !isMemberOwner && (
                        <DropdownMenuItem onClick={() => transferOwnership(m)} className="gap-2">
                          <Crown className="h-4 w-4" /> Transfer ownership
                        </DropdownMenuItem>
                      )}
                      {!isMemberOwner && (
                        <DropdownMenuItem
                          onClick={() => removeMember(m)}
                          className="gap-2 text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" /> Remove
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            );
          })}
        </ul>
      </OrgSectionCard>

      {invites.length > 0 && (
        <OrgSectionCard title={`Pending invitations (${invites.length})`} icon={MailX}>
          <ul className="divide-y divide-border/60">
            {invites.map((inv) => {
              const readyToGrant = inv.awaitingRecipientKey && !!inv.recipientReadyAt;
              const canGrant = role === "owner" || role === "admin";
              const stateLabel =
                inv.role === "guest"
                  ? "Guest"
                  : inv.spaceKeyReady
                    ? "Key ready"
                    : readyToGrant
                      ? "Ready"
                      : "Awaiting signup";
              return (
                <li key={inv.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{inv.email}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {inv.role} · invited {formatDate(inv.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          inv.spaceKeyReady || readyToGrant ? "secondary" : "outline"
                        }
                      >
                        {stateLabel}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => cancelInvite(inv.id)}
                        disabled={busy !== null}
                      >
                        {busy === `cancel-${inv.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          "Cancel"
                        )}
                      </Button>
                    </div>
                  </div>

                  {inv.previouslyMember && (
                    <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-amber-500/5 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Was a member
                      {inv.lastRemovedAt ? ` until ${formatDate(inv.lastRemovedAt)}` : ""} and
                      was removed — re-inviting starts a fresh membership.
                    </p>
                  )}

                  {readyToGrant && canGrant && (
                    <Button
                      size="sm"
                      className="mt-2"
                      onClick={() => grantAccess(inv)}
                      disabled={busy !== null}
                    >
                      {busy === `grant-${inv.id}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      )}
                      Grant access
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </OrgSectionCard>
      )}
    </div>
  );
}
