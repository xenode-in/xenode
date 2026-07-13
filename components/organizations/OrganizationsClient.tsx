"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Files,
  ImagePlus,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCrypto } from "@/contexts/CryptoContext";
import { useSession } from "@/lib/auth/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  generateOrgSpaceKey,
  unwrapSpaceKeyGrant,
  wrapSpaceKeyForCryptoKey,
  wrapSpaceKeyForPublicKey,
} from "@/lib/orgs/spaceKeyClient";
import { cn, formatDate } from "@/lib/utils";

type OrgRole = "owner" | "admin" | "manager" | "member" | "guest";
type InviteRole = "admin" | "manager" | "member" | "guest";

interface SessionUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

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
  awaitingRecipientKey?: boolean;
  recipientReadyAt?: string | null;
  previouslyMember?: boolean;
  lastRemovedAt?: string | null;
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

function initialsOf(source: string | null | undefined) {
  const value = (source || "?").trim();
  return value
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Downscales/re-encodes a raster image entirely in the browser until it fits
 * under `maxBytes`. SVGs (vector) and already-small files pass through
 * untouched. Returns a WebP File when re-encoding was needed.
 */
async function compressImageToLimit(
  file: File,
  maxBytes: number,
): Promise<File> {
  if (file.type === "image/svg+xml" || file.size <= maxBytes) {
    return file;
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = dataUrl;
  });

  let maxDim = 1024;
  let quality = 0.9;

  for (let attempt = 0; attempt < 10; attempt++) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), "image/webp", quality),
    );

    if (blob && blob.size <= maxBytes) {
      const baseName = file.name.replace(/\.[^.]+$/, "") || "logo";
      return new File([blob], `${baseName}.webp`, { type: "image/webp" });
    }

    // Tighten quality first, then dimensions, and retry.
    if (quality > 0.5) {
      quality -= 0.15;
    } else {
      maxDim = Math.round(maxDim * 0.8);
    }
  }

  return file;
}

export function OrganizationsClient({ user }: { user: SessionUser }) {
  const router = useRouter();
  const { data: session } = useSession();
  const { isUnlocked, publicKey, privateKey, setModalOpen } = useCrypto();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [orgInvites, setOrgInvites] = useState<Invitation[]>([]);
  const [myInvites, setMyInvites] = useState<Invitation[]>([]);
  const [manageOrgId, setManageOrgId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Creation wizard state
  const [createOpen, setCreateOpen] = useState(false);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [createStep, setCreateStep] = useState(0);
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState<string>("");
  const [teamSize, setTeamSize] = useState<string>("");
  const [website, setWebsite] = useState("");
  const [logo, setLogo] = useState<string>("");
  const [logoUploading, setLogoUploading] = useState(false);

  // Invite state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("member");

  const manageOrg = useMemo(
    () => orgs.find((org) => org.id === manageOrgId) ?? null,
    [orgs, manageOrgId],
  );
  const canAdminManageOrg = !!manageOrg && ADMIN_ROLES.includes(manageOrg.role);
  const currentUserId = session?.user?.id ?? user.id;
  const pendingInvites = useMemo(
    () => myInvites.filter((invite) => invite.status === "pending"),
    [myInvites],
  );

  const loadOrgs = useCallback(async () => {
    const data = await readJson<{ organizations: Organization[] }>(
      await fetch("/api/orgs"),
    );
    setOrgs(data.organizations);
  }, []);

  const loadMyInvites = useCallback(async () => {
    const data = await readJson<{ invitations: Invitation[] }>(
      await fetch("/api/orgs/invitations"),
    );
    setMyInvites(data.invitations);
  }, []);

  const loadManagedOrg = useCallback(async (orgId: string) => {
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
    void loadManagedOrg(manageOrgId);
  }, [loadManagedOrg, manageOrgId]);

  const openCreate = () => {
    setOrgName("");
    setOrgType("");
    setTeamSize("");
    setWebsite("");
    setLogo("");
    setCreateStep(0);
    setCreateOpen(true);
  };

  const uploadLogo = async (file: File) => {
    setLogoUploading(true);
    try {
      const prepared = await compressImageToLimit(file, LOGO_MAX_BYTES);
      const form = new FormData();
      form.append("file", prepared);
      const data = await readJson<{ url: string }>(
        await fetch("/api/orgs/logo", { method: "POST", body: form }),
      );
      setLogo(data.url);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload logo",
      );
    } finally {
      setLogoUploading(false);
    }
  };

  const createOrganization = async () => {
    const name = orgName.trim();
    if (!name) {
      toast.error("Organization name is required");
      setCreateStep(0);
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
            orgType: orgType || undefined,
            teamSize: teamSize || undefined,
            website: website.trim() || undefined,
            logo: logo || undefined,
            ownerWrappedSpaceKey,
            keyVersion: 1,
          }),
        }),
      );

      toast.success("Organization created");
      setCreateOpen(false);
      setOrgName("");
      setOrgType("");
      setTeamSize("");
      setWebsite("");
      setLogo("");
      setCreateStep(0);
      await refresh();
      setManageOrgId(data.organization.id);
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

  const loadRawSpaceKey = async (
    orgId: string,
  ): Promise<{ rawSpaceKey: Uint8Array; keyVersion: number }> => {
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
    const rawSpaceKey = await unwrapSpaceKeyGrant({
      wrappedSpaceKey: grant.wrappedSpaceKey,
      privateKey,
    });
    return { rawSpaceKey, keyVersion: grant.keyVersion };
  };

  const inviteMember = async () => {
    if (!manageOrg) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      toast.error("Email is required");
      return;
    }

    setBusy("invite");
    try {
      let wrappedSpaceKey = "";
      let recipientUserId: string | null = null;
      let keyVersion = 1;
      let deferred = false;

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

        const recipient = lookup.recipients[0];
        if (recipient) {
          // Recipient already has a vault → wrap the key now (immediate access).
          const key = await loadRawSpaceKey(manageOrg.id);
          keyVersion = key.keyVersion;
          wrappedSpaceKey = await wrapSpaceKeyForPublicKey({
            rawSpaceKey: key.rawSpaceKey,
            recipientPublicKey: recipient.publicKey,
          });
          recipientUserId = recipient.userId;
        } else {
          // No account / no vault yet → deferred invite. The key is granted once
          // they sign up and set up their vault. Other reasons (e.g. inviting
          // yourself) still error.
          const reason = lookup.unavailable[0]?.reason || "";
          const deferrable = /no xenode account|encryption vault/i.test(reason);
          if (!deferrable) {
            throw new Error(reason || "Recipient is not available");
          }
          deferred = true;
        }
      }

      await readJson<{ invitation: Invitation }>(
        await fetch(`/api/orgs/${manageOrg.id}/invitations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            role: inviteRole,
            recipientUserId,
            wrappedSpaceKey,
            keyVersion,
          }),
        }),
      );

      setInviteEmail("");
      toast.success(
        deferred
          ? "Invitation emailed — they'll get access after signing up"
          : "Invitation sent",
      );
      await loadManagedOrg(manageOrg.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send invitation",
      );
    } finally {
      setBusy(null);
    }
  };

  // Grant the deferred space key to an invitee who has now set up their vault.
  const grantAccess = async (invite: Invitation) => {
    if (!manageOrg) return;
    setBusy(`grant-${invite.id}`);
    try {
      if (!privateKey) {
        setModalOpen(true);
        throw new Error("Unlock your vault to grant encrypted access");
      }

      const lookup = await readJson<{
        recipients: RecipientLookup[];
        unavailable: Array<{ email: string; reason: string }>;
      }>(
        await fetch("/api/orgs/recipients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: [invite.email] }),
        }),
      );
      const recipient = lookup.recipients[0];
      if (!recipient) {
        throw new Error(
          lookup.unavailable[0]?.reason ||
            "The invitee hasn't finished setting up their vault yet",
        );
      }

      const { rawSpaceKey, keyVersion } = await loadRawSpaceKey(manageOrg.id);
      const wrappedSpaceKey = await wrapSpaceKeyForPublicKey({
        rawSpaceKey,
        recipientPublicKey: recipient.publicKey,
      });

      await readJson(
        await fetch(
          `/api/orgs/${manageOrg.id}/invitations/${invite.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wrappedSpaceKey, keyVersion }),
          },
        ),
      );

      toast.success("Access granted — they can now join");
      await loadManagedOrg(manageOrg.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to grant access",
      );
    } finally {
      setBusy(null);
    }
  };

  const removeMember = async (member: Member) => {
    if (!manageOrg) return;
    if (member.userId === currentUserId) {
      toast.error("Self-removal is not available here");
      return;
    }

    const label = member.user?.email || member.user?.name || member.userId;
    if (!window.confirm(`Remove ${label} from ${manageOrg.name}?`)) {
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
          await fetch(`/api/orgs/${manageOrg.id}/keys`),
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
        await fetch(`/api/orgs/${manageOrg.id}/members/${member.userId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rotationGrants }),
        }),
      );

      toast.success("Member removed");
      await loadManagedOrg(manageOrg.id);
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
      toast.success(
        action === "accept" ? "Invitation accepted" : "Invitation rejected",
      );
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

  const activeOrg = orgs.find((org) => org.isActive) ?? null;
  const pendingOrgInvites = orgInvites.filter(
    (invite) => invite.status === "pending",
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Back to personal dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <Link href="/organizations" className="flex items-center gap-2">
              <span className="font-brand text-lg italic text-foreground">
                Xenode
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Teams
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setInvitesOpen(true)}
              className="relative text-muted-foreground hover:text-foreground"
            >
              <Mail className="h-4 w-4" />
              <span className="hidden sm:inline">Invitations</span>
              {pendingInvites.length > 0 && (
                <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                  {pendingInvites.length}
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={refresh}
              disabled={busy !== null}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Refresh"
            >
              <RefreshCw
                className={cn("h-4 w-4", loading && "animate-spin")}
              />
            </Button>
            <Avatar className="h-8 w-8">
              <AvatarImage src={user.image || undefined} />
              <AvatarFallback className="bg-primary/15 text-xs text-primary">
                {initialsOf(user.name || user.email)}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {/* Page heading */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Organizations
            </h1>
            <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
              Encrypted team spaces. Switch your active scope, manage members,
              and keep files under organization-owned storage.
            </p>
          </div>
          <Button onClick={openCreate} className="shrink-0">
            <Plus className="h-4 w-4" />
            New organization
          </Button>
        </div>

        {/* Pending invitations prompt */}
        {pendingInvites.length > 0 && (
          <button
            type="button"
            onClick={() => setInvitesOpen(true)}
            className="mt-8 flex w-full items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 text-left transition-colors hover:bg-primary/10"
          >
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
                <Mail className="h-4 w-4 text-primary" />
              </span>
              <span className="text-sm font-medium text-foreground">
                You have {pendingInvites.length} pending invitation
                {pendingInvites.length > 1 ? "s" : ""}
              </span>
            </span>
            <span className="text-sm font-medium text-primary">Review</span>
          </button>
        )}

        {/* Workspaces grid */}
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
            <Building2 className="h-4 w-4 text-primary" />
            Your workspaces
          </div>

          {loading ? (
            <div className="flex items-center justify-center rounded-2xl border border-dashed border-border py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {/* Personal space */}
              <div className="flex flex-col justify-between rounded-2xl border border-border bg-card p-5">
                <div className="flex items-start justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary">
                    <Lock className="h-5 w-5 text-muted-foreground" />
                  </div>
                  {!activeOrg && <Badge>Active</Badge>}
                </div>
                <div className="mt-4">
                  <p className="font-medium text-foreground">Personal space</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Your private Xenode drive
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 w-full"
                  onClick={() => switchScope(null)}
                  disabled={busy !== null || !activeOrg}
                >
                  {busy === "personal" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : !activeOrg ? (
                    <Check className="h-4 w-4" />
                  ) : null}
                  {!activeOrg ? "Current scope" : "Switch here"}
                </Button>
              </div>

              {/* Organizations */}
              {orgs.map((org) => (
                <div
                  key={org.id}
                  className={cn(
                    "flex flex-col justify-between rounded-2xl border bg-card p-5 transition-colors",
                    org.isActive
                      ? "border-primary/50 ring-1 ring-primary/20"
                      : "border-border",
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-sm font-semibold text-primary">
                      {org.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={org.logo}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        initialsOf(org.name)
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {org.isActive && <Badge>Active</Badge>}
                      <Badge variant="outline">{roleLabel(org.role)}</Badge>
                    </div>
                  </div>
                  <div className="mt-4">
                    <p className="truncate font-medium text-foreground">
                      {org.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {org.slug || org.id}
                    </p>
                  </div>
                  <div className="mt-4 flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant={org.isActive ? "secondary" : "default"}
                      className="flex-1"
                      onClick={() => switchScope(org.id)}
                      disabled={busy !== null || org.isActive}
                    >
                      {busy === org.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-4 w-4" />
                      )}
                      {org.isActive ? "Selected" : "Select"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setManageOrgId(org.id)}
                      disabled={busy !== null}
                      aria-label="Manage members"
                    >
                      <Users className="h-4 w-4" />
                    </Button>
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      aria-label="Organization files"
                    >
                      <Link href={`/organizations/${org.id}/files`}>
                        <Files className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}

              {/* Create tile */}
              <button
                type="button"
                onClick={openCreate}
                className="flex min-h-[184px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-5 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent/40 hover:text-foreground"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary">
                  <Plus className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium">New organization</span>
              </button>
            </div>
          )}
        </section>
      </main>

      {/* Creation wizard */}
      <CreateOrgWizard
        open={createOpen}
        onOpenChange={setCreateOpen}
        step={createStep}
        setStep={setCreateStep}
        orgName={orgName}
        setOrgName={setOrgName}
        orgType={orgType}
        setOrgType={setOrgType}
        teamSize={teamSize}
        setTeamSize={setTeamSize}
        website={website}
        setWebsite={setWebsite}
        logo={logo}
        setLogo={setLogo}
        onUploadLogo={uploadLogo}
        logoUploading={logoUploading}
        onCreate={createOrganization}
        busy={busy === "create"}
        vaultUnlocked={isUnlocked}
      />

      {/* Invitations slide-over */}
      <Sheet open={invitesOpen} onOpenChange={setInvitesOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              Invitations
            </SheetTitle>
            <SheetDescription>
              Organizations that have invited you to collaborate.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-2.5 px-4 pb-8">
            {pendingInvites.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-secondary/40">
                  <Mail className="h-6 w-6 text-muted-foreground/50" />
                </div>
                <p className="text-sm font-medium text-foreground/70">
                  No pending invitations
                </p>
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                  When someone invites you to an organization, it will show up
                  here.
                </p>
              </div>
            ) : (
              pendingInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium text-foreground">
                          {invite.organization?.name || invite.organizationId}
                        </p>
                        <Badge variant="outline">{roleLabel(invite.role)}</Badge>
                        {invite.spaceKeyReady && (
                          <Badge variant="secondary">Key ready</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Expires {formatDate(invite.expiresAt)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
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
                      className="flex-1"
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
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Manage members slide-over */}
      <Sheet
        open={!!manageOrgId}
        onOpenChange={(open) => {
          if (!open) setManageOrgId("");
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              {manageOrg?.name || "Members"}
            </SheetTitle>
            <SheetDescription>
              Manage who can access this encrypted workspace.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6 px-4 pb-8">
            {manageOrg && (
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/organizations/${manageOrg.id}/files`}>
                    <Files className="h-4 w-4" />
                    Files
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/organizations/${manageOrg.id}/settings`}>
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>
                </Button>
              </div>
            )}

            {/* Invite */}
            {canAdminManageOrg && (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <UserPlus className="h-4 w-4 text-primary" />
                  Invite member
                </div>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-email">Email</Label>
                    <Input
                      id="invite-email"
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="teammate@example.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Select
                      value={inviteRole}
                      onValueChange={(value) =>
                        setInviteRole(value as InviteRole)
                      }
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
              </div>
            )}

            {/* Members */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Members
              </p>
              {members.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No visible members.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {members.map((member) => (
                    <div
                      key={member.userId}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={member.user?.image || undefined} />
                          <AvatarFallback className="bg-secondary text-xs">
                            {initialsOf(member.user?.name || member.user?.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {member.user?.name ||
                              member.user?.email ||
                              member.userId}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {roleLabel(member.role)}
                          </p>
                        </div>
                      </div>
                      {canAdminManageOrg &&
                        member.userId !== currentUserId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeMember(member)}
                            disabled={busy !== null}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label="Remove member"
                          >
                            {busy === `remove-${member.userId}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pending invites */}
            {canAdminManageOrg && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Pending invitations
                </p>
                {pendingOrgInvites.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No pending invitations.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {pendingOrgInvites.map((invite) => {
                      const readyToGrant =
                        invite.awaitingRecipientKey && !!invite.recipientReadyAt;
                      return (
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
                                {roleLabel(invite.role)} · expires{" "}
                                {formatDate(invite.expiresAt)}
                              </p>
                            </div>
                            <Badge
                              variant={
                                invite.role === "guest"
                                  ? "outline"
                                  : invite.spaceKeyReady
                                    ? "secondary"
                                    : readyToGrant
                                      ? "default"
                                      : "outline"
                              }
                            >
                              {invite.role === "guest"
                                ? "Guest"
                                : invite.spaceKeyReady
                                  ? "Key ready"
                                  : readyToGrant
                                    ? "Ready"
                                    : "Awaiting signup"}
                            </Badge>
                          </div>

                          {invite.previouslyMember && (
                            <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-500/5 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              Was a member
                              {invite.lastRemovedAt
                                ? ` until ${formatDate(invite.lastRemovedAt)}`
                                : ""}{" "}
                              and was removed — re-inviting starts a fresh
                              membership.
                            </p>
                          )}

                          {readyToGrant && (
                            <Button
                              size="sm"
                              className="mt-2 w-full"
                              onClick={() => grantAccess(invite)}
                              disabled={busy !== null}
                            >
                              {busy === `grant-${invite.id}` ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <KeyRound className="h-4 w-4" />
                              )}
                              Grant access
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

const ORG_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "company", label: "Company" },
  { value: "startup", label: "Startup" },
  { value: "agency", label: "Agency" },
  { value: "nonprofit", label: "Non-profit" },
  { value: "education", label: "Education" },
  { value: "government", label: "Government" },
  { value: "personal", label: "Personal / Family" },
  { value: "other", label: "Other" },
];

const TEAM_SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: "1-10", label: "1–10 people" },
  { value: "11-50", label: "11–50 people" },
  { value: "51-200", label: "51–200 people" },
  { value: "201-500", label: "201–500 people" },
  { value: "500+", label: "500+ people" },
];

const WIZARD_STEPS = ["Details", "Team", "Review"];

function optionLabel(
  options: { value: string; label: string }[],
  value: string,
) {
  return options.find((option) => option.value === value)?.label ?? "—";
}

function CreateOrgWizard({
  open,
  onOpenChange,
  step,
  setStep,
  orgName,
  setOrgName,
  orgType,
  setOrgType,
  teamSize,
  setTeamSize,
  website,
  setWebsite,
  logo,
  setLogo,
  onUploadLogo,
  logoUploading,
  onCreate,
  busy,
  vaultUnlocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: number;
  setStep: (step: number) => void;
  orgName: string;
  setOrgName: (name: string) => void;
  orgType: string;
  setOrgType: (value: string) => void;
  teamSize: string;
  setTeamSize: (value: string) => void;
  website: string;
  setWebsite: (value: string) => void;
  logo: string;
  setLogo: (value: string) => void;
  onUploadLogo: (file: File) => void;
  logoUploading: boolean;
  onCreate: () => void;
  busy: boolean;
  vaultUnlocked: boolean;
}) {
  const trimmed = orgName.trim();
  const logoInputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            New organization
          </DialogTitle>
          <DialogDescription>
            Tell us a little about your team, then we&apos;ll set up an encrypted
            workspace.
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-2">
          {WIZARD_STEPS.map((label, index) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors",
                  index < step
                    ? "bg-primary text-primary-foreground"
                    : index === step
                      ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                      : "bg-secondary text-muted-foreground",
                )}
              >
                {index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </div>
              <span
                className={cn(
                  "hidden text-xs font-medium sm:inline",
                  index === step ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
              {index < WIZARD_STEPS.length - 1 && (
                <div className="h-px flex-1 bg-border" />
              )}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-4 py-1">
            {/* Logo */}
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logo}
                    alt="Organization logo"
                    className="h-full w-full object-cover"
                  />
                ) : trimmed ? (
                  <span className="text-lg font-semibold text-muted-foreground">
                    {initialsOf(trimmed)}
                  </span>
                ) : (
                  <ImagePlus className="h-6 w-6 text-muted-foreground/50" />
                )}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) onUploadLogo(file);
                      event.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={logoUploading}
                  >
                    {logoUploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    {logo ? "Change logo" : "Upload logo"}
                  </Button>
                  {logo && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setLogo("")}
                      disabled={logoUploading}
                      className="text-muted-foreground"
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PNG, JPEG, WebP or SVG. Optional — large images are optimized
                  automatically.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wizard-org-name">
                Organization name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="wizard-org-name"
                value={orgName}
                autoFocus
                onChange={(event) => setOrgName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && trimmed && orgType) setStep(1);
                }}
                placeholder="Acme Labs"
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label>
                What kind of organization?{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Select value={orgType} onValueChange={setOrgType}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a type" />
                </SelectTrigger>
                <SelectContent>
                  {ORG_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="wizard-org-website">
                Website{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="wizard-org-website"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="acme.com"
                maxLength={200}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label>
                How many people work there?{" "}
                <span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-1 gap-2">
                {TEAM_SIZE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setTeamSize(option.value)}
                    className={cn(
                      "flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors",
                      teamSize === option.value
                        ? "border-primary/60 bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      {option.label}
                    </span>
                    {teamSize === option.value && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                This helps us tailor storage and collaboration defaults.
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-2">
              <ReviewCell label="Name" value={trimmed} full />
              <ReviewCell
                label="Type"
                value={orgType ? optionLabel(ORG_TYPE_OPTIONS, orgType) : "—"}
              />
              <ReviewCell
                label="Team size"
                value={teamSize ? optionLabel(TEAM_SIZE_OPTIONS, teamSize) : "—"}
              />
              <ReviewCell label="Website" value={website.trim() || "—"} full />
            </div>
            <ul className="space-y-2 pt-1 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                An encrypted space key is generated in your browser and wrapped
                to your vault.
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                A shared workspace bucket is provisioned automatically.
              </li>
            </ul>
            {!vaultUnlocked && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                Your vault is locked. You&apos;ll be prompted to unlock it to
                finish.
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() =>
              step === 0 ? onOpenChange(false) : setStep(step - 1)
            }
            disabled={busy}
          >
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {step < 2 ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={
                (step === 0 && (!trimmed || !orgType)) ||
                (step === 1 && !teamSize)
              }
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={onCreate} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              Create organization
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReviewCell({
  label,
  value,
  full,
}: {
  label: string;
  value: string;
  full?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3",
        full && "col-span-2",
      )}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate font-medium text-foreground">{value}</p>
    </div>
  );
}
