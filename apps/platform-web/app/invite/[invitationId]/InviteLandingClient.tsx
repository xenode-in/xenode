"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  Clock,
  KeyRound,
  Loader2,
  LogIn,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setPostAuthRedirect } from "@/lib/postAuthRedirect";

interface PublicInvitation {
  id: string;
  organizationName: string;
  organizationLogo: string | null;
  role: string;
  status: "pending" | "accepted" | "rejected" | "canceled" | "expired";
  expiresAt: string;
  email: string;
  emailHint: string;
  spaceKeyReady: boolean;
}

function roleLabel(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        {children}
      </div>
    </div>
  );
}

export function InviteLandingClient({
  invitationId,
  sessionEmail,
  isAuthenticated,
}: {
  invitationId: string;
  sessionEmail: string | null;
  isAuthenticated: boolean;
}) {
  const [invite, setInvite] = useState<PublicInvitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const invitePath = `/invite/${invitationId}`;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/orgs/invitations/${invitationId}/public`);
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !data.invitation) {
          setNotFound(true);
        } else {
          setInvite(data.invitation as PublicInvitation);
        }
      } catch {
        if (active) setNotFound(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [invitationId]);

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </Shell>
    );
  }

  if (notFound || !invite) {
    return (
      <Shell>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
            <X className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">
            Invitation not found
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This invitation link is invalid or has been removed.
          </p>
        </div>
      </Shell>
    );
  }

  const header = (
    <div className="mb-6 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-primary/10">
        {invite.organizationLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={invite.organizationLogo}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <Building2 className="h-7 w-7 text-primary" />
        )}
      </div>
      <h1 className="text-xl font-semibold text-foreground">
        Join {invite.organizationName}
      </h1>
      <p className="mt-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        Invited as
        <Badge variant="outline">{roleLabel(invite.role)}</Badge>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">For {invite.email}</p>
    </div>
  );

  if (invite.status !== "pending") {
    const label =
      invite.status === "expired"
        ? "This invitation has expired."
        : invite.status === "accepted"
          ? "This invitation has already been accepted."
          : invite.status === "rejected"
            ? "This invitation was declined."
            : "This invitation is no longer available.";
    return (
      <Shell>
        {header}
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {label}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {header}
      {isAuthenticated ? (
        <AuthenticatedActions
          invite={invite}
          invitationId={invitationId}
          invitePath={invitePath}
          sessionEmail={sessionEmail}
        />
      ) : (
        <UnauthenticatedActions invitePath={invitePath} invite={invite} />
      )}
    </Shell>
  );
}

function UnauthenticatedActions({
  invitePath,
  invite,
}: {
  invitePath: string;
  invite: PublicInvitation;
}) {
  const go = (mode: "signup" | "login") => {
    setPostAuthRedirect(invitePath);
    const params = new URLSearchParams();
    if (mode === "signup") params.set("mode", "signup");
    if (invite.email) params.set("email", invite.email);
    window.location.href = `/login?${params.toString()}`;
  };

  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-muted-foreground">
        Create your free Xenode account to accept this invitation. Sign up with{" "}
        <span className="font-medium text-foreground">{invite.email}</span>.
      </p>
      <Button className="w-full" onClick={() => go("signup")}>
        <UserPlus className="h-4 w-4" />
        Create account & join
      </Button>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => go("login")}
      >
        <LogIn className="h-4 w-4" />
        I already have an account
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Encrypted access is activated after you finish setting up your vault.
      </p>
    </div>
  );
}

type ClaimState =
  | "checking"
  | "ready" // guest or key already wrapped → can accept
  | "needVault" // account exists but no encryption vault yet
  | "awaitingGrant" // claimed; waiting for an admin to grant the key
  | "mismatch" // signed in as a different email
  | "error";

function AuthenticatedActions({
  invite,
  invitationId,
  invitePath,
  sessionEmail,
}: {
  invite: PublicInvitation;
  invitationId: string;
  invitePath: string;
  sessionEmail: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const canAcceptDirectly = invite.role === "guest" || invite.spaceKeyReady;
  const [state, setState] = useState<ClaimState>(
    canAcceptDirectly ? "ready" : "checking",
  );

  const claim = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/orgs/invitations/${invitationId}/claim`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setState("mismatch");
        return;
      }
      if (!res.ok) {
        setState("error");
        return;
      }
      if (data.ready) setState("ready");
      else if (data.needsVault) setState("needVault");
      else setState("awaitingGrant");
    } catch {
      setState("error");
    }
  }, [invitationId]);

  useEffect(() => {
    if (!canAcceptDirectly) void claim();
  }, [canAcceptDirectly, claim]);

  const act = async (action: "accept" | "reject") => {
    setBusy(true);
    try {
      const res = await fetch(`/api/orgs/invitations/${invitationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setState("mismatch");
        return;
      }
      if (res.status === 409 && data?.code === "space_key_grant_required") {
        // Non-guest invite without a key yet — fall back to claim/waiting.
        await claim();
        return;
      }
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update invitation");
      }
      if (action === "accept") {
        toast.success(`Joined ${invite.organizationName}`);
        router.push("/organizations");
      } else {
        toast.success("Invitation declined");
        router.push("/dashboard");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  };

  if (state === "mismatch") {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-600 dark:text-amber-400">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This invitation is for {invite.email}, but you&apos;re signed in
            {sessionEmail ? ` as ${sessionEmail}` : ""}. Sign out and use the
            invited email.
          </span>
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            setPostAuthRedirect(invitePath);
            router.push("/login");
          }}
        >
          <LogIn className="h-4 w-4" />
          Switch account
        </Button>
      </div>
    );
  }

  if (state === "checking") {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state === "needVault") {
    return (
      <div className="space-y-3 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-secondary">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          Finish setting up your encryption vault to unlock encrypted access,
          then return here to join.
        </p>
        <Button
          className="w-full"
          onClick={() => {
            setPostAuthRedirect(invitePath);
            router.push("/onboarding");
          }}
        >
          Set up my vault
        </Button>
      </div>
    );
  }

  if (state === "awaitingGrant") {
    return (
      <div className="space-y-3 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-secondary">
          <Clock className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">
          You&apos;re all set
        </p>
        <p className="text-sm text-muted-foreground">
          Waiting for {invite.organizationName} to grant your encrypted access.
          We&apos;ll notify you by email when it&apos;s ready — you can safely
          close this page.
        </p>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => router.push("/dashboard")}
        >
          Go to dashboard
        </Button>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load this invitation right now. Please try again.
        </p>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => window.location.reload()}
        >
          Retry
        </Button>
      </div>
    );
  }

  // state === "ready"
  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        onClick={() => act("accept")}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Check className="h-4 w-4" />
        )}
        Accept & join {invite.organizationName}
      </Button>
      <Button
        variant="ghost"
        className="w-full text-muted-foreground"
        onClick={() => act("reject")}
        disabled={busy}
      >
        Decline
      </Button>
    </div>
  );
}
