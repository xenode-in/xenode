"use client";

import { useCallback, useEffect, useState } from "react";
import { Globe2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  OrgPageHeader,
  OrgSectionCard,
  OrgLoading,
} from "@/components/organizations/org-ui";

interface Policy {
  allowPublicLinks: boolean;
  allowGuests: boolean;
  allowExternalUploads: boolean;
  requirePassword: boolean;
  requireExpiry: boolean;
}
type PolicyKey = keyof Policy;

const POLICY_FIELDS: { key: PolicyKey; label: string; hint: string }[] = [
  { key: "allowPublicLinks", label: "Allow public share links", hint: "Members can create links accessible without sign-in." },
  { key: "allowGuests", label: "Allow guests", hint: "Members can share resources with external guests." },
  { key: "allowExternalUploads", label: "Allow guest uploads", hint: "Guests can upload to resources shared with them." },
  { key: "requirePassword", label: "Require share passwords", hint: "Public links must be password protected." },
  { key: "requireExpiry", label: "Require share expiry", hint: "Public links must have an expiration date." },
];

type JoinPolicy = "off" | "suggest" | "auto";

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data as T;
}

export function OrgSecurityClient({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>("off");
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [verifiedDomains, setVerifiedDomains] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, o, d] = await Promise.all([
        readJson<{ policy: Policy }>(await fetch(`/api/orgs/${orgId}/policy`)),
        readJson<{ organization: { domainJoinPolicy: JoinPolicy; autoJoinRequiresApproval: boolean } }>(
          await fetch(`/api/orgs/${orgId}`),
        ),
        readJson<{ domains: { domain: string; status: string }[] }>(await fetch(`/api/orgs/${orgId}/domains`)),
      ]);
      setPolicy(p.policy);
      setJoinPolicy(o.organization.domainJoinPolicy ?? "off");
      setRequiresApproval(o.organization.autoJoinRequiresApproval ?? true);
      setVerifiedDomains(d.domains.filter((x) => x.status === "verified").map((x) => x.domain));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load security settings");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updatePolicy(key: PolicyKey, value: boolean) {
    if (!policy) return;
    setPolicy({ ...policy, [key]: value });
    setBusy(key);
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}/policy`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: value }),
        }),
      );
    } catch (error) {
      setPolicy({ ...policy, [key]: !value }); // revert
      toast.error(error instanceof Error ? error.message : "Failed to update policy");
    } finally {
      setBusy(null);
    }
  }

  async function updateJoin(next: { domainJoinPolicy?: JoinPolicy; autoJoinRequiresApproval?: boolean }) {
    setBusy("join");
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        }),
      );
      if (next.domainJoinPolicy) setJoinPolicy(next.domainJoinPolicy);
      if (typeof next.autoJoinRequiresApproval === "boolean") setRequiresApproval(next.autoJoinRequiresApproval);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update join policy");
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (loading || !policy) return <OrgLoading />;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <OrgPageHeader title="Security" description="Sharing policies and domain-based access for this organization." />

      <OrgSectionCard title="External sharing policy" icon={ShieldCheck}>
        <ul className="divide-y divide-border/60">
          {POLICY_FIELDS.map((f) => (
            <li key={f.key} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{f.label}</p>
                <p className="text-xs text-muted-foreground">{f.hint}</p>
              </div>
              <div className="flex items-center gap-2">
                {busy === f.key && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                <Switch
                  checked={policy[f.key]}
                  disabled={!canManage || busy !== null}
                  onCheckedChange={(v) => updatePolicy(f.key, v)}
                />
              </div>
            </li>
          ))}
        </ul>
      </OrgSectionCard>

      <OrgSectionCard title="Domain access" icon={Globe2}>
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-sm font-medium text-foreground">Verified domains</p>
            {verifiedDomains.length === 0 ? (
              <p className="text-xs text-muted-foreground">No verified domains yet — add one in Settings.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {verifiedDomains.map((d) => (
                  <Badge key={d} variant="secondary">{d}</Badge>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Domain join policy</p>
              <p className="text-xs text-muted-foreground">
                Users with a verified email domain. Auto-join admits guests only (members need an invite).
              </p>
            </div>
            <Select
              value={joinPolicy}
              onValueChange={(v) => updateJoin({ domainJoinPolicy: v as JoinPolicy })}
              disabled={!canManage || busy !== null}
            >
              <SelectTrigger className="w-36 capitalize"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="suggest">Suggest</SelectItem>
                <SelectItem value="auto">Auto-join</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {joinPolicy === "auto" && (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">Require admin approval</p>
                <p className="text-xs text-muted-foreground">Approve each domain join before access is granted.</p>
              </div>
              <Switch
                checked={requiresApproval}
                disabled={!canManage || busy !== null}
                onCheckedChange={(v) => updateJoin({ autoJoinRequiresApproval: v })}
              />
            </div>
          )}
        </div>
      </OrgSectionCard>
    </div>
  );
}
