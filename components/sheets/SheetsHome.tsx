"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FilePlus2, Search, Sheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
function FileGrid({ title, items }: { title: string; items: Array<Item & { displayName: string; href: string }> }) { return <section><h2 className="mb-3 text-base font-semibold">{title}</h2>{items.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{items.map((item) => <Link key={item.href} href={item.href} className="rounded-xl border bg-card p-4 transition hover:border-emerald-500/50 hover:shadow-sm"><Sheet className="mb-8 h-7 w-7 text-emerald-500"/><p className="truncate text-sm font-medium">{item.displayName}</p><p className="mt-1 text-xs text-muted-foreground">Encrypted spreadsheet</p></Link>)}</div> : <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No spreadsheets here yet.</div>}</section>; }

function OrganizationSpreadsheetSection({ organization, query }: { organization: Organization; query: string }) {
  return <WorkspaceScopeProvider driveScope={{ type: "organization", orgId: organization.id, orgName: organization.name, role: organization.role }}><OrganizationSpreadsheetFiles organization={organization} query={query}/></WorkspaceScopeProvider>;
}
function OrganizationSpreadsheetFiles({ organization, query }: { organization: Organization; query: string }) {
  const workspace = useWorkspace(); const space = useWorkspaceSpaceKey(); const { addTasks } = useUpload(); const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Array<Item & { displayName: string; href: string }>>([]); const [bucket, setBucket] = useState<string | null>(null);
  useEffect(() => {
    if (!space.cryptoKey) return;
    let cancelled = false;
    Promise.all([workspace.scopedFetch("/api/buckets"), workspace.scopedFetch("/api/objects?fetchAll=true&mediaCategory=excel")]).then(async ([bucketResponse, objectResponse]) => {
      if (!bucketResponse.ok || !objectResponse.ok || cancelled) return;
      const bucketRows = (await bucketResponse.json()).buckets ?? []; const objectRows = (await objectResponse.json()).objects ?? [];
      const bucketId = bucketRows[0]?._id ?? bucketRows[0]?.id ?? null; setBucket(bucketId);
      const prefix = "workspaces/" + organization.id + "/objects/";
      const mapped = await Promise.all(objectRows.map(async (item: Item) => ({ ...item, displayName: item.encryptedName ? await decryptMetadataString(item.encryptedName, space.cryptoKey) : "Encrypted spreadsheet", href: "/sheets/editor?id=" + (item._id ?? item.id) + "&orgId=" + organization.id + "&bucketId=" + bucketId + "&prefix=" + encodeURIComponent(prefix) })));
      if (!cancelled) setItems(mapped);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [organization.id, space.cryptoKey, workspace]);
  const prefix = "workspaces/" + organization.id + "/objects/";
  const upload = (files: FileList | null) => { if (!bucket || !files) return; addTasks(Array.from(files).filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name)), bucket, prefix); };
  const blank = () => { if (!bucket) return; const buffer = normalizedToXlsx(createBlankWorkbook()); addTasks([new File([buffer], "Untitled spreadsheet.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })], bucket, prefix); };
  const visible = items.filter((item) => item.displayName.toLowerCase().includes(query.toLowerCase()));
  return <div className="space-y-3"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">{organization.name}</p><div className="flex gap-1"><input ref={input} className="hidden" type="file" accept=".xlsx,.xls,.csv" multiple onChange={(event) => upload(event.target.files)}/><Button size="sm" variant="ghost" onClick={() => input.current?.click()}>Upload</Button><Button size="sm" variant="ghost" onClick={blank}>New</Button></div></div><FileGrid title="" items={visible}/></div>;
}
export function SheetsHome() {
  const { data: session } = useSession(); const { metadataKey } = useCrypto(); const { addTasks } = useUpload();
  const inputRef = useRef<HTMLInputElement>(null); const [query, setQuery] = useState(""); const [personal, setPersonal] = useState<Array<Item & { displayName: string; href: string }>>([]); const [recent, setRecent] = useState<Array<Item & { displayName: string; href: string }>>([]); const [bucket, setBucket] = useState<{ id: string; prefix: string } | null>(null); const [organizations, setOrganizations] = useState<Organization[]>([]);
  const load = useCallback(async () => {
    if (!session?.user.id || !metadataKey) return;
    const [objectsResponse, bucketsResponse, organizationsResponse] = await Promise.all([fetch("/api/objects?fetchAll=true&mediaCategory=excel"), fetch("/api/buckets"), fetch("/api/orgs")]);
    if (organizationsResponse.ok) setOrganizations((await organizationsResponse.json()).organizations ?? []);
    const objects = objectsResponse.ok ? ((await objectsResponse.json()).objects ?? []) as Item[] : [];
    const buckets = bucketsResponse.ok ? ((await bucketsResponse.json()).buckets ?? []) : [];
    const firstBucket = buckets[0]; if (firstBucket) setBucket({ id: firstBucket._id ?? firstBucket.id, prefix: `users/${session.user.id}/` });
    const mapped = await Promise.all(objects.map(async (item) => ({ ...item, displayName: item.encryptedName ? await decryptMetadataString(item.encryptedName, metadataKey) : "Encrypted spreadsheet", href: `/sheets/editor?id=${item._id ?? item.id}` })));
    setPersonal(mapped);
    const rows = await getDb(session.user.id).spreadsheetRecents.orderBy("lastOpenedAt").reverse().limit(12).toArray();
    const allowed = (await Promise.all(rows.map(async (row) => { const response = await fetch(`/api/objects/${row.objectId}`); if (!response.ok) return null; const meta = await response.json(); const displayName = meta.encryptedName ? await decryptMetadataString(meta.encryptedName, metadataKey) : "Encrypted spreadsheet"; return { id: row.objectId, displayName, href: `/sheets/editor?id=${row.objectId}`, lastAccessedAt: new Date(row.lastOpenedAt).toISOString() }; }))).filter(Boolean) as Array<Item & { displayName: string; href: string }>;
    setRecent(allowed);
  }, [metadataKey, session]);
  // Matches existing client-list loading convention.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => personal.filter((item) => item.displayName.toLowerCase().includes(query.toLowerCase())), [personal, query]);
  const upload = (files: FileList | null) => { if (!bucket || !files) return; const supported = Array.from(files).filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name)); addTasks(supported, bucket.id, bucket.prefix); };
  const blank = () => { if (!bucket) return; const buffer = normalizedToXlsx(createBlankWorkbook()); addTasks([new File([buffer], "Untitled spreadsheet.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })], bucket.id, bucket.prefix); };
  return <main className="h-full overflow-auto"><div className="mx-auto max-w-7xl space-y-10 p-5 md:p-10"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-sm font-medium text-emerald-500">Xenode Sheets</p><h1 className="text-3xl font-semibold tracking-tight">Encrypted spreadsheets, edited locally.</h1></div><div className="flex gap-2"><input ref={inputRef} className="hidden" type="file" accept=".xlsx,.xls,.csv" multiple onChange={(event) => upload(event.target.files)}/><Button variant="outline" onClick={() => inputRef.current?.click()}><Upload className="mr-2 h-4 w-4"/>Upload</Button><Button onClick={blank}><FilePlus2 className="mr-2 h-4 w-4"/>New spreadsheet</Button></div></div><div className="relative max-w-lg"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"/><Input className="pl-9" placeholder="Search decrypted names on this device" value={query} onChange={(event) => setQuery(event.target.value)}/></div><FileGrid title="Recently opened" items={recent}/><FileGrid title="Personal spreadsheets" items={visible}/><section className="space-y-5"><h2 className="text-base font-semibold">Organization spreadsheets</h2>{organizations.length ? organizations.map((organization) => <OrganizationSpreadsheetSection key={organization.id} organization={organization} query={query}/>) : <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No organization workspaces available.</div>}</section><FileGrid title="Shared with me" items={[]}/></div></main>;
}

