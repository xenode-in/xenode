"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Building2, FilePlus2, Loader2, Search, Sheet, Upload, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useCrypto } from "@/contexts/CryptoContext";
import { useUpload } from "@/contexts/UploadContext";
import { useSession } from "@/lib/auth/client";
import { decryptMetadataString } from "@/lib/crypto/fileEncryption";
import { createBlankWorkbook, normalizedToXlsx } from "@/lib/spreadsheets/xlsxAdapter";
import { getDb } from "@/lib/db/local";
import { WorkspaceScopeProvider, useWorkspace } from "@/contexts/WorkspaceContext";
import { useWorkspaceSpaceKey } from "@/lib/orgs/useWorkspaceSpaceKey";
import type { WorkspaceNav } from "@/lib/navigation/sidebar-nav";

type Organization = { id: string; name: string; role?: WorkspaceNav["role"] };
type Item = { _id?: string; id?: string; encryptedName?: string | null; contentType?: string; bucketId?: string; lastAccessedAt?: string; name?: string };

function FileGrid({ title, items }: { title: string; items: Array<Item & { displayName: string; href: string }> }) {
  return (
    <section>
      {title && <h2 className="mb-3 text-base font-semibold">{title}</h2>}
      {items.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-xl border bg-card p-4 transition hover:border-emerald-500/50 hover:shadow-sm">
              <Sheet className="mb-8 h-7 w-7 text-emerald-500" />
              <p className="truncate text-sm font-medium">{item.displayName}</p>
              <p className="mt-1 text-xs text-muted-foreground">Encrypted spreadsheet</p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No spreadsheets here yet.</div>
      )}
    </section>
  );
}

/* ── Personal scope content ─────────────────────────────────────────────── */

function PersonalScopeContent({ query }: { query: string }) {
  const { data: session } = useSession();
  const { metadataKey } = useCrypto();
  const { addTasks } = useUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [personal, setPersonal] = useState<Array<Item & { displayName: string; href: string }>>([]);
  const [recent, setRecent] = useState<Array<Item & { displayName: string; href: string }>>([]);
  const [driveConfig, setDriveConfig] = useState<{ bucketId: string; rootPrefix: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!session?.user.id || !metadataKey) return;
    setLoading(true);
    try {
      // Use /api/drive/config — the same endpoint the dashboard uses
      const configRes = await fetch("/api/drive/config");
      if (!configRes.ok) { setLoading(false); return; }
      const config = await configRes.json();
      if (!config.bucket) { setLoading(false); return; }
      const bucketId = config.bucket._id;
      const rootPrefix = config.rootPrefix ?? `users/${session.user.id}/`;
      setDriveConfig({ bucketId, rootPrefix });

      const objectsRes = await fetch(`/api/objects?fetchAll=true&mediaCategory=excel&bucketId=${bucketId}`);
      const objects = objectsRes.ok ? (((await objectsRes.json()).objects ?? []) as Item[]) : [];
      const mapped = await Promise.all(
        objects.map(async (item) => ({
          ...item,
          displayName: item.encryptedName ? await decryptMetadataString(item.encryptedName, metadataKey) : "Encrypted spreadsheet",
          href: `/sheets/editor?id=${item._id ?? item.id}`,
        }))
      );
      setPersonal(mapped);
      const rows = await getDb(session.user.id).spreadsheetRecents.orderBy("lastOpenedAt").reverse().limit(12).toArray();
      const allowed = (
        await Promise.all(
          rows.map(async (row) => {
            const response = await fetch(`/api/objects/${row.objectId}`);
            if (!response.ok) return null;
            const meta = await response.json();
            const displayName = meta.encryptedName ? await decryptMetadataString(meta.encryptedName, metadataKey) : "Encrypted spreadsheet";
            return { id: row.objectId, displayName, href: `/sheets/editor?id=${row.objectId}`, lastAccessedAt: new Date(row.lastOpenedAt).toISOString() };
          })
        )
      ).filter(Boolean) as Array<Item & { displayName: string; href: string }>;
      setRecent(allowed);
    } finally {
      setLoading(false);
    }
  }, [metadataKey, session]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(
    () => personal.filter((item) => item.displayName.toLowerCase().includes(query.toLowerCase())),
    [personal, query]
  );

  const upload = (files: FileList | null) => {
    if (!driveConfig || !files) return;
    const supported = Array.from(files).filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name));
    addTasks(supported, driveConfig.bucketId, driveConfig.rootPrefix);
  };

  const blank = () => {
    if (!driveConfig) return;
    const buffer = normalizedToXlsx(createBlankWorkbook());
    addTasks(
      [new File([buffer], "Untitled spreadsheet.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })],
      driveConfig.bucketId,
      driveConfig.rootPrefix
    );
  };

  return (
    <div className="space-y-8">
      {/* Action bar */}
      <div className="flex items-center gap-2">
        <input ref={inputRef} className="hidden" type="file" accept=".xlsx,.xls,.csv" multiple onChange={(event) => upload(event.target.files)} />
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={!driveConfig}>
          <Upload className="mr-2 h-4 w-4" />Upload
        </Button>
        <Button size="sm" onClick={blank} disabled={!driveConfig}>
          <FilePlus2 className="mr-2 h-4 w-4" />New spreadsheet
        </Button>
        {loading && <Loader2 className="ml-2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {recent.length > 0 && <FileGrid title="Recently opened" items={recent} />}
      <FileGrid title="My spreadsheets" items={visible} />
    </div>
  );
}

/* ── Organization scope content ─────────────────────────────────────────── */

function OrganizationScopeContent({ organization, query }: { organization: Organization; query: string }) {
  return (
    <WorkspaceScopeProvider driveScope={{ type: "organization", orgId: organization.id, orgName: organization.name, role: organization.role }}>
      <OrganizationScopeFiles organization={organization} query={query} />
    </WorkspaceScopeProvider>
  );
}

function OrganizationScopeFiles({ organization, query }: { organization: Organization; query: string }) {
  const workspace = useWorkspace();
  const space = useWorkspaceSpaceKey();
  const { addTasks } = useUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Array<Item & { displayName: string; href: string }>>([]);
  const [driveConfig, setDriveConfig] = useState<{ bucketId: string; rootPrefix: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!space.cryptoKey) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Use /api/drive/config with scoped fetch — same as FilesBrowser
        const configRes = await workspace.scopedFetch("/api/drive/config");
        if (!configRes.ok || cancelled) return;
        const config = await configRes.json();
        if (!config.bucket || cancelled) return;
        const bucketId = config.bucket._id;
        const rootPrefix = config.rootPrefix ?? `workspaces/${organization.id}/objects/`;
        setDriveConfig({ bucketId, rootPrefix });

        const objectsRes = await workspace.scopedFetch(`/api/objects?fetchAll=true&mediaCategory=excel&bucketId=${bucketId}`);
        if (!objectsRes.ok || cancelled) return;
        const objectRows = (await objectsRes.json()).objects ?? [];
        const mapped = await Promise.all(
          objectRows.map(async (item: Item) => ({
            ...item,
            displayName: item.encryptedName ? await decryptMetadataString(item.encryptedName, space.cryptoKey) : "Encrypted spreadsheet",
            href: "/sheets/editor?id=" + (item._id ?? item.id) + "&orgId=" + organization.id + "&bucketId=" + bucketId + "&prefix=" + encodeURIComponent(rootPrefix),
          }))
        );
        if (!cancelled) setItems(mapped);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [organization.id, space.cryptoKey, workspace]);

  const upload = (files: FileList | null) => {
    if (!driveConfig || !files) return;
    addTasks(
      Array.from(files).filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name)),
      driveConfig.bucketId,
      driveConfig.rootPrefix
    );
  };

  const blank = () => {
    if (!driveConfig) return;
    const buffer = normalizedToXlsx(createBlankWorkbook());
    addTasks(
      [new File([buffer], "Untitled spreadsheet.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })],
      driveConfig.bucketId,
      driveConfig.rootPrefix
    );
  };

  const visible = items.filter((item) => item.displayName.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-8">
      {/* Action bar */}
      <div className="flex items-center gap-2">
        <input ref={inputRef} className="hidden" type="file" accept=".xlsx,.xls,.csv" multiple onChange={(event) => upload(event.target.files)} />
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={!driveConfig}>
          <Upload className="mr-2 h-4 w-4" />Upload
        </Button>
        <Button size="sm" onClick={blank} disabled={!driveConfig}>
          <FilePlus2 className="mr-2 h-4 w-4" />New spreadsheet
        </Button>
        {loading && <Loader2 className="ml-2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <FileGrid title={`${organization.name} spreadsheets`} items={visible} />
    </div>
  );
}

/* ── Main SheetsHome ────────────────────────────────────────────────────── */

export function SheetsHome() {
  const { data: session } = useSession();
  const { metadataKey } = useCrypto();
  const [query, setQuery] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeTab, setActiveTab] = useState("personal");

  useEffect(() => {
    if (!session?.user.id || !metadataKey) return;
    fetch("/api/orgs")
      .then(async (res) => {
        if (res.ok) setOrganizations((await res.json()).organizations ?? []);
      })
      .catch(() => {});
  }, [session, metadataKey]);

  const tabOptions = useMemo(() => {
    const tabs: Array<{ value: string; label: string; icon: React.ReactNode }> = [
      { value: "personal", label: "Personal", icon: <User className="h-4 w-4" /> },
    ];
    for (const org of organizations) {
      tabs.push({ value: `org-${org.id}`, label: org.name, icon: <Building2 className="h-4 w-4" /> });
    }
    return tabs;
  }, [organizations]);

  return (
    <main className="h-full overflow-auto">
      <div className="mx-auto max-w-7xl space-y-8 p-5 md:p-10">
        {/* Header */}
        <div>
          <p className="text-sm font-medium text-emerald-500">Xenode Sheets</p>
          <h1 className="text-3xl font-semibold tracking-tight">Encrypted spreadsheets, edited locally.</h1>
        </div>

        {/* Search */}
        <div className="relative max-w-lg">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search decrypted names on this device" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>

        {/* Scope tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList variant="line">
            {tabOptions.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-2">
                {tab.icon}
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="personal" className="mt-6">
            <PersonalScopeContent query={query} />
          </TabsContent>

          {organizations.map((org) => (
            <TabsContent key={org.id} value={`org-${org.id}`} className="mt-6">
              <OrganizationScopeContent organization={org} query={query} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </main>
  );
}
