"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Clipboard,
  Globe2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";

type DomainStatus = "pending" | "verified" | "failed";

interface OrgDomainRow {
  id: string;
  domain: string;
  verificationToken: string;
  status: DomainStatus;
  method: "dns_txt";
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Request failed",
    );
  }
  return data as T;
}

function statusBadge(status: DomainStatus) {
  if (status === "verified") {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Verified
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="gap-1 text-destructive">
        <XCircle className="h-3 w-3" />
        Needs DNS
      </Badge>
    );
  }
  return <Badge variant="outline">Pending</Badge>;
}

export function OrgSettingsClient({
  orgId,
  canAdmin,
}: {
  orgId: string;
  canAdmin: boolean;
}) {
  const [domains, setDomains] = useState<OrgDomainRow[]>([]);
  const [domainInput, setDomainInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const loadDomains = useCallback(async () => {
    setLoading(true);
    try {
      const data = await readJson<{ domains: OrgDomainRow[] }>(
        await fetch(`/api/orgs/${orgId}/domains`),
      );
      setDomains(data.domains);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load domains",
      );
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadDomains();
  }, [loadDomains]);

  const addDomain = async () => {
    const domain = domainInput.trim();
    if (!domain) {
      toast.error("Domain is required");
      return;
    }
    setBusy("add-domain");
    try {
      await readJson<{ domain: OrgDomainRow }>(
        await fetch(`/api/orgs/${orgId}/domains`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain }),
        }),
      );
      setDomainInput("");
      toast.success("Domain added");
      await loadDomains();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add domain");
    } finally {
      setBusy(null);
    }
  };

  const verifyDomain = async (domainId: string) => {
    setBusy(`verify-${domainId}`);
    try {
      await readJson<{ domain: OrgDomainRow }>(
        await fetch(`/api/orgs/${orgId}/domains/${domainId}/verify`, {
          method: "POST",
        }),
      );
      toast.success("Domain verified");
      await loadDomains();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "TXT record was not found",
      );
      await loadDomains();
    } finally {
      setBusy(null);
    }
  };

  const copyToken = async (token: string) => {
    await navigator.clipboard.writeText(token);
    toast.success("Verification token copied");
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <Badge variant="secondary">Workspace identity</Badge>
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              Domain verification
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Verify domains your organization controls before using them for trusted collaboration policies.
            </p>
          </div>
          <Button variant="outline" onClick={loadDomains} disabled={busy !== null}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">Add domain</h3>
        </div>
        {!canAdmin ? (
          <p className="text-sm text-muted-foreground">
            Only owners and admins can manage verified domains.
          </p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1 space-y-2">
              <Label htmlFor="org-domain">Domain</Label>
              <Input
                id="org-domain"
                value={domainInput}
                onChange={(event) => setDomainInput(event.target.value)}
                placeholder="example.com"
              />
            </div>
            <Button
              className="sm:self-end"
              onClick={addDomain}
              disabled={busy !== null}
            >
              {busy === "add-domain" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border p-5">
          <h3 className="text-sm font-medium">Verified identity domains</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Add the TXT value to DNS, then run verification.
          </p>
        </div>

        {loading ? (
          <div className="flex min-h-[180px] items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : domains.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No domains have been added yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {domains.map((domain) => (
              <div key={domain.id} className="p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">
                        {domain.domain}
                      </p>
                      {statusBadge(domain.status)}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      TXT record on root domain. Last checked{" "}
                      {domain.lastCheckedAt
                        ? formatDate(domain.lastCheckedAt)
                        : "never"}
                    </p>
                    <div className="mt-3 rounded-lg border border-border bg-background p-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        TXT value
                      </p>
                      <p className="mt-1 break-all font-mono text-xs text-foreground">
                        {domain.verificationToken}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToken(domain.verificationToken)}
                    >
                      <Clipboard className="h-4 w-4" />
                      Copy
                    </Button>
                    {canAdmin && (
                      <Button
                        size="sm"
                        onClick={() => verifyDomain(domain.id)}
                        disabled={busy !== null}
                      >
                        {busy === `verify-${domain.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-4 w-4" />
                        )}
                        Verify
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
