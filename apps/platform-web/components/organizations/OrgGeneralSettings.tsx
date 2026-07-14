"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrgSectionCard, OrgLoading } from "@/components/organizations/org-ui";

interface OrgSettings {
  id: string;
  name: string;
  logo: string | null;
  primaryColor: string | null;
  emailBranding: string | null;
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data as T;
}

export function OrgGeneralSettings({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [logo, setLogo] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [emailBranding, setEmailBranding] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await readJson<{ organization: OrgSettings }>(await fetch(`/api/orgs/${orgId}`));
      setSettings(d.organization);
      setName(d.organization.name ?? "");
      setLogo(d.organization.logo ?? "");
      setPrimaryColor(d.organization.primaryColor ?? "");
      setEmailBranding(d.organization.emailBranding ?? "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy("save");
    try {
      await readJson(
        await fetch(`/api/orgs/${orgId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            logo: logo.trim() || null,
            primaryColor: primaryColor.trim() || null,
            emailBranding: emailBranding.trim() || null,
          }),
        }),
      );
      toast.success("Settings saved");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setBusy(null);
    }
  }

  async function deleteOrg() {
    if (!settings) return;
    const confirmText = window.prompt(
      `This schedules "${settings.name}" for deletion (30-day recovery). Type the org name to confirm:`,
    );
    if (confirmText !== settings.name) {
      if (confirmText !== null) toast.error("Name did not match");
      return;
    }
    setBusy("delete");
    try {
      await readJson(await fetch(`/api/orgs/${orgId}`, { method: "DELETE" }));
      toast.success("Organization scheduled for deletion");
      await fetch("/api/orgs/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: null }),
      });
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete");
      setBusy(null);
    }
  }

  if (loading) return <OrgLoading />;

  return (
    <div className="space-y-6">
      <OrgSectionCard title="Organization info" icon={Building2}>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Name</Label>
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-logo">Logo URL</Label>
              <Input id="org-logo" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-color">Primary color</Label>
              <Input id="org-color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} placeholder="#00297a" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-email">Email branding (footer/signature)</Label>
            <Input id="org-email" value={emailBranding} onChange={(e) => setEmailBranding(e.target.value)} placeholder="Sent by Acme Inc." />
          </div>
          <Button onClick={save} disabled={busy !== null}>
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
          </Button>
        </div>
      </OrgSectionCard>

      <section className="rounded-xl border border-destructive/20 bg-card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-destructive">
          <Trash2 className="h-4 w-4" /> Danger zone
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Deleting schedules the organization for permanent removal after a 30-day recovery window. All members lose access.
        </p>
        <Button variant="destructive" onClick={deleteOrg} disabled={busy !== null}>
          {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete organization"}
        </Button>
      </section>
    </div>
  );
}
