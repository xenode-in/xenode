"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  Files,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCrypto } from "@/contexts/CryptoContext";
import { useSession } from "@/lib/auth/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  generateOrgSpaceKey,
  unwrapSpaceKeyGrant,
  wrapSpaceKeyForCryptoKey,
  wrapSpaceKeyForPublicKey,
} from "@/lib/orgs/spaceKeyClient";
import { cn, formatDate } from "@/lib/utils";

type OrgRole = "owner" | "admin" | "manager" | "member" | "guest";
type InviteRole = "admin" | "manager" | "member" | "guest";

interface Organization {
  id: string;
  name: string;
  slug: string | null;
  logo: string | null;
  role: OrgRole;
  isActive: boolean;
  createdAt: string | null;
  spaceKeyReady?: boolean;
}

interface Member {
  id: string | null;
  userId: string;
  role: OrgRole;
  createdAt: string | null;
  user: {
    id: string;
    email: string | null;
    name: string | null;
    image: string | null;
  } | null;
}

interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: InviteRole;
  status: string;
  inviterId: string;
  expiresAt: string;
  createdAt: string;
  recipientUserId: string | null;
  spaceKeyReady: boolean;
  organization?: {
    id: string;
    name: string;
    slug: string | null;
    logo: string | null;
  } | null;
}

interface RecipientLookup {
  userId: string;
  email: string;
  name: string | null;
  publicKey: string;
}

interface SpaceKeyGrant {
  wrappedSpaceKey: string;
  keyVersion: number;
}

const INVITE_ROLES: InviteRole[] = ["member", "manager", "admin", "guest"];
const ADMIN_ROLES: OrgRole[] = ["owner", "admin"];

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Request failed",
    );
  }
  return data as T;
}

function roleLabel(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function OrganizationsClient() {
  const router = useRouter();
  const { data: session } = useSession();
  const { isUnlocked, publicKey, privateKey, setModalOpen } = useCrypto();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [orgInvites, setOrgInvites] = useState<Invitation[]>([]);
  const [myInvites, setMyInvites] = useState<Invitation[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("member");

  const selectedOrg = useMemo(
    () => orgs.find((org) => org.id === selectedOrgId) ?? orgs[0] ?? null,
    [orgs, selectedOrgId],
  );
  const canAdminSelectedOrg =
    !!selectedOrg && ADMIN_ROLES.includes(selectedOrg.role);
  const currentUserId = session?.user?.id ?? "";

  const loadOrgs = useCallback(async () => {
    const data = await readJson<{ organizations: Organization[] }>(
      await fetch("/api/orgs"),
    );
    setOrgs(data.organizations);
    setSelectedOrgId((current) => {
      if (current && data.organizations.some((org) => org.id === current)) {
        return current;
      }
      return data.organizations.find((org) => org.isActive)?.id ||
        data.organizations[0]?.id ||
        "";
    });
  }, []);

  const loadMyInvites = useCallback(async () => {
    const data = await readJson<{ invitations: Invitation[] }>(
      await fetch("/api/orgs/invitations"),
    );
    setMyInvites(data.invitations);
  }, []);

  const loadSelectedOrg = useCallback(async (orgId: string) => {
    if (!orgId) {
      setMembers([]);
      setOrgInvites([]);
      return;
    }

    const [membersData, invitesData] = await Promise.all([
      readJson<{ members: Member[] }>(
        await fetch(`/api/orgs/${orgId}/members`),
      ),
      readJson<{ invitations: Invitation[] }>(
        await fetch(`/api/orgs/${orgId}/invitations`),
      ).catch(() => ({ invitations: [] })),
    ]);
    setMembers(membersData.members);
    setOrgInvites(invitesData.invitations);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadOrgs(), loadMyInvites()]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load organizations",
      );
    } finally {
      setLoading(false);
    }
  }, [loadMyInvites, loadOrgs]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void loadSelectedOrg(selectedOrg?.id ?? "");
  }, [loadSelectedOrg, selectedOrg?.id]);

  const createOrganization = async () => {
    const name = orgName.trim();
    if (!name) {
      toast.error("Organization name is required");
      return;
    }
    if (!isUnlocked || !publicKey) {
      setModalOpen(true);
      toast.error("Unlock your vault before creating an encrypted organization");
      return;
    }

    setBusy("create");
    try {
      const rawSpaceKey = generateOrgSpaceKey();
      const ownerWrappedSpaceKey = await wrapSpaceKeyForCryptoKey({
        rawSpaceKey,
        publicKey,
      });
      const data = await readJson<{ organization: Organization }>(
        await fetch("/api/orgs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            ownerWrappedSpaceKey,
            keyVersion: 1,
          }),
        }),
      );

      setOrgName("");
      toast.success("Organization created");
      await refresh();
      setSelectedOrgId(data.organization.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create organization",
      );
    } finally {
      setBusy(null);
    }
  };

  const switchScope = async (orgId: string | null) => {
    setBusy(orgId ?? "personal");
    try {
      await readJson<{ activeOrganizationId: string | null }>(
        await fetch("/api/orgs/active", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId }),
        }),
      );
      toast.success(orgId ? "Organization selected" : "Personal scope selected");
      await refresh();
      router.push(orgId ? "/dashboard/org/files" : "/dashboard");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to switch scope",
      );
    } finally {
      setBusy(null);
    }
  };

  const loadRawSpaceKey = async (orgId: string): Promise<Uint8Array> => {
    if (!privateKey) {
      setModalOpen(true);
      throw new Error("Unlock your vault before inviting encrypted members");
    }

    const data = await readJson<{ grants: SpaceKeyGrant[] }>(
      await fetch(`/api/orgs/${orgId}/keys`),
    );
    const grant = data.grants[0];
    if (!grant) {
      throw new Error("Your organization space key is not available");
    }
    return unwrapSpaceKeyGrant({
      wrappedSpaceKey: grant.wrappedSpaceKey,
      privateKey,
    });
  };

  const inviteMember = async () => {
    if (!selectedOrg) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      toast.error("Email is required");
      return;
    }

    setBusy("invite");
    try {
      let recipient: RecipientLookup | null = null;
      let wrappedSpaceKey = "";
      let recipientUserId: string | null = null;

      if (inviteRole !== "guest") {
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
          throw new Error(
            lookup.unavailable[0]?.reason || "Recipient is not available",
          );
        }

        recipient = lookup.recipients[0];
        const rawSpaceKey = await loadRawSpaceKey(selectedOrg.id);
        wrappedSpaceKey = await wrapSpaceKeyForPublicKey({
          rawSpaceKey,
          recipientPublicKey: recipient.publicKey,
        });
        recipientUserId = recipient.userId;
      }

      await readJson<{ invitation: Invitation }>(
        await fetch(`/api/orgs/${selectedOrg.id}/invitations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            role: inviteRole,
            recipientUserId,
            wrappedSpaceKey,
            keyVersion: 1,
          }),
        }),
      );

      setInviteEmail("");
      toast.success("Invitation sent");
      await loadSelectedOrg(selectedOrg.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send invitation",
      );
    } finally {
      setBusy(null);
    }
  };

  const removeMember = async (member: Member) => {
    if (!selectedOrg) return;
    if (member.userId === currentUserId) {
      toast.error("Self-removal is not available here");
      return;
    }

    const label = member.user?.email || member.user?.name || member.userId;
    if (!window.confirm(`Remove ${label} from ${selectedOrg.name}?`)) {
      return;
    }

    setBusy(`remove-${member.userId}`);
    try {
      let rotationGrants: Array<{
        memberUserId: string;
        wrappedSpaceKey: string;
        keyVersion: number;
      }> = [];

      if (member.role !== "guest") {
        if (!publicKey) {
          setModalOpen(true);
          throw new Error("Unlock your vault before rotating organization keys");
        }

        const keyData = await readJson<{ grants: SpaceKeyGrant[] }>(
          await fetch(`/api/orgs/${selectedOrg.id}/keys`),
        );
        const nextKeyVersion = (keyData.grants[0]?.keyVersion ?? 0) + 1;
        const nextSpaceKey = generateOrgSpaceKey();
        const remainingKeyMembers = members.filter(
          (candidate) =>
            candidate.userId !== member.userId && candidate.role !== "guest",
        );
        const otherMembers = remainingKeyMembers.filter(
          (candidate) => candidate.userId !== currentUserId,
        );
        const otherEmails = otherMembers.map((candidate) => candidate.user?.email);

        if (otherEmails.some((email) => !email)) {
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
            lookup.unavailable
              .map((item) => `${item.email}: ${item.reason}`)
              .join(" | "),
          );
        }

        const recipientByUserId = new Map(
          lookup.recipients.map((recipient) => [recipient.userId, recipient]),
        );
        const missingRecipient = otherMembers.find(
          (candidate) => !recipientByUserId.has(candidate.userId),
        );
        if (missingRecipient) {
          throw new Error(
            `${missingRecipient.user?.email || missingRecipient.userId}: public key is unavailable`,
          );
        }

        rotationGrants = await Promise.all(
          remainingKeyMembers.map(async (candidate) => {
            const wrappedSpaceKey =
              candidate.userId === currentUserId
                ? await wrapSpaceKeyForCryptoKey({
                    rawSpaceKey: nextSpaceKey,
                    publicKey,
                  })
                : await wrapSpaceKeyForPublicKey({
                    rawSpaceKey: nextSpaceKey,
                    recipientPublicKey:
                      recipientByUserId.get(candidate.userId)?.publicKey || "",
                  });

            if (!wrappedSpaceKey) {
              throw new Error("Failed to prepare a rotation grant");
            }

            return {
              memberUserId: candidate.userId,
              wrappedSpaceKey,
              keyVersion: nextKeyVersion,
            };
          }),
        );
      }

      await readJson<{ removedMemberUserId: string }>(
        await fetch(`/api/orgs/${selectedOrg.id}/members/${member.userId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rotationGrants }),
        }),
      );

      toast.success("Member removed");
      await loadSelectedOrg(selectedOrg.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove member",
      );
    } finally {
      setBusy(null);
    }
  };

  const actOnInvitation = async (
    invitationId: string,
    action: "accept" | "reject",
  ) => {
    setBusy(`${action}-${invitationId}`);
    try {
      await readJson<{ invitation: Invitation }>(
        await fetch(`/api/orgs/invitations/${invitationId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }),
      );
      toast.success(action === "accept" ? "Invitation accepted" : "Invitation rejected");
      await refresh();
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update invitation",
      );
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="secondary">Collaboration</Badge>
              <Badge variant="outline">Encrypted space keys</Badge>
            </div>
            <h2 className="text-2xl font-semibold text-foreground">
              Organization workspaces
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Create a team space, switch your active collaboration scope, and keep files under organization-owned routes and storage.
            </p>
          </div>
          <Button variant="outline" onClick={refresh} disabled={busy !== null}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs defaultValue="spaces" className="space-y-4">
        <TabsList>
          <TabsTrigger value="spaces">
            <Building2 className="h-4 w-4" />
            Spaces
          </TabsTrigger>
          <TabsTrigger value="invitations">
            <Mail className="h-4 w-4" />
            Invitations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="spaces" className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-medium">Create organization</h2>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1 space-y-2">
                <Label htmlFor="org-name">Name</Label>
                <Input
                  id="org-name"
                  value={orgName}
                  onChange={(event) => setOrgName(event.target.value)}
                  placeholder="Acme Labs"
                  maxLength={80}
                />
              </div>
              <Button
                className="sm:self-end"
                onClick={createOrganization}
                disabled={busy !== null}
              >
                {busy === "create" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                Create
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              A shared workspace bucket is provisioned automatically when the organization is created.
            </p>
          </section>

          <section className="rounded-xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-medium">Your organizations</h2>
            </div>

            {orgs.length === 0 ? (
              <EmptyState>No organizations yet.</EmptyState>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">Personal space</p>
                      <p className="text-xs text-muted-foreground">
                        Your private Xenode drive
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => switchScope(null)}
                      disabled={busy !== null || orgs.every((org) => !org.isActive)}
                    >
                      {busy === "personal" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      Use personal
                    </Button>
                  </div>
                </div>

                {orgs.map((org) => (
                  <div
                    key={org.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedOrgId(org.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedOrgId(org.id);
                      }
                    }}
                    className={cn(
                      "w-full rounded-lg border p-4 text-left transition-colors",
                      selectedOrg?.id === org.id
                        ? "border-primary/60 bg-primary/5"
                        : "border-border hover:bg-accent/50",
                    )}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{org.name}</p>
                          <Badge variant="outline">{roleLabel(org.role)}</Badge>
                          {org.isActive && <Badge>Active</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {org.slug || org.id}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link
                            href={`/organizations/${org.id}/files`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Files className="h-4 w-4" />
                            Files
                          </Link>
                        </Button>
                        <Button asChild variant="outline" size="sm">
                          <Link
                            href={`/organizations/${org.id}/settings`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Settings className="h-4 w-4" />
                            Settings
                          </Link>
                        </Button>
                        <Button
                          variant={org.isActive ? "secondary" : "outline"}
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            void switchScope(org.id);
                          }}
                          disabled={busy !== null || org.isActive}
                        >
                          {busy === org.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ShieldCheck className="h-4 w-4" />
                          )}
                          {org.isActive ? "Selected" : "Select"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {selectedOrg && (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
              <section className="rounded-xl border border-border bg-card p-6">
                <div className="mb-4 flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-medium">Members</h2>
                </div>
                {members.length === 0 ? (
                  <EmptyState>No visible members.</EmptyState>
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {members.map((member) => (
                      <div
                        key={member.userId}
                        className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {member.user?.name || member.user?.email || member.userId}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {member.user?.email || member.userId}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{roleLabel(member.role)}</Badge>
                          {canAdminSelectedOrg && member.userId !== currentUserId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeMember(member)}
                              disabled={busy !== null}
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            >
                              {busy === `remove-${member.userId}` ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                              Remove
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-border bg-card p-6">
                <div className="mb-4 flex items-center gap-2">
                  <Send className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-medium">Invite member</h2>
                </div>
                {!canAdminSelectedOrg ? (
                  <EmptyState>Only owners and admins can invite members.</EmptyState>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="invite-email">Email</Label>
                      <Input
                        id="invite-email"
                        type="email"
                        value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                        placeholder="teammate@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Role</Label>
                      <Select
                        value={inviteRole}
                        onValueChange={(value) => setInviteRole(value as InviteRole)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INVITE_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {roleLabel(role)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      className="w-full"
                      onClick={inviteMember}
                      disabled={busy !== null}
                    >
                      {busy === "invite" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Send invite
                    </Button>
                  </div>
                )}

                <div className="mt-6 space-y-3">
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Pending
                  </p>
                  {orgInvites.filter((invite) => invite.status === "pending")
                    .length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No pending invitations.
                    </p>
                  ) : (
                    orgInvites
                      .filter((invite) => invite.status === "pending")
                      .map((invite) => (
                        <div
                          key={invite.id}
                          className="rounded-lg border border-border p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {invite.email}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {roleLabel(invite.role)} - expires{" "}
                                {formatDate(invite.expiresAt)}
                              </p>
                            </div>
                            <Badge
                              variant={invite.spaceKeyReady ? "secondary" : "outline"}
                            >
                              {invite.spaceKeyReady ? "Key ready" : "Guest"}
                            </Badge>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </section>
            </div>
          )}
        </TabsContent>

        <TabsContent value="invitations" className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-medium">Incoming invitations</h2>
            </div>
            {myInvites.length === 0 ? (
              <EmptyState>No pending invitations.</EmptyState>
            ) : (
              <div className="space-y-3">
                {myInvites.map((invite) => (
                  <div key={invite.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">
                            {invite.organization?.name || invite.organizationId}
                          </p>
                          <Badge variant="outline">{roleLabel(invite.role)}</Badge>
                          {invite.spaceKeyReady && (
                            <Badge variant="secondary">Key ready</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Expires {formatDate(invite.expiresAt)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => actOnInvitation(invite.id, "accept")}
                          disabled={busy !== null}
                        >
                          {busy === `accept-${invite.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => actOnInvitation(invite.id, "reject")}
                          disabled={busy !== null}
                        >
                          {busy === `reject-${invite.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <X className="h-4 w-4" />
                          )}
                          Reject
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
