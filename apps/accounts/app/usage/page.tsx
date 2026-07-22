import { AccountShell } from "@/components/AccountShell";
import { loadUsage } from "@/lib/hub-data";
import { bytesLabel, usagePercent } from "@/lib/presentation";
import { requireAccountsPageSession } from "@/lib/session";

export default async function UsagePage() {
  const session = await requireAccountsPageSession();
  const usage = await loadUsage(session.user.id);
  const percent = usagePercent(usage.storageBytes, usage.storageLimitBytes);
  return (
    <AccountShell user={session.user}>
      <main className="page">
        <p className="eyebrow">Read-only statistics</p>
        <h1>Usage</h1>
        <p className="lede">Billing-safe byte and count totals across your personal account. The Accounts hub never reads encrypted names, file keys, or object contents.</p>
        <section className="card" style={{ marginTop: 32 }}>
          <div className="section-heading" style={{ marginTop: 0 }}><div><p className="eyebrow">Current plan</p><h2 style={{ textTransform: "capitalize" }}>{usage.plan}</h2></div><span className="badge">{usage.status}</span></div>
          <div className="button-row" style={{ justifyContent: "space-between" }}><strong>{bytesLabel(usage.storageBytes)} used</strong><span className="fine-print">{bytesLabel(usage.storageLimitBytes)} total</span></div>
          <div className="progress" style={{ marginTop: 12 }} aria-label={`${percent}% storage used`}><span style={{ width: `${percent}%` }} /></div>
        </section>
        <section className="grid grid-3" style={{ marginTop: 16 }}>
          <article className="card"><span className="muted">Objects</span><div className="stat-value">{usage.objects.toLocaleString()}</div></article>
          <article className="card"><span className="muted">Buckets</span><div className="stat-value">{usage.buckets.toLocaleString()}</div></article>
          <article className="card"><span className="muted">Egress</span><div className="stat-value">{bytesLabel(usage.egressBytes)}</div></article>
          <article className="card"><span className="muted">Uploads</span><div className="stat-value">{usage.uploads.toLocaleString()}</div></article>
          <article className="card"><span className="muted">Downloads</span><div className="stat-value">{usage.downloads.toLocaleString()}</div></article>
          <article className="card"><span className="muted">Organizations</span><div className="stat-value">{usage.organizations.toLocaleString()}</div></article>
        </section>
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Active products</h2>
          <div className="button-row" style={{ marginTop: 14 }}>
            {usage.activeProducts.length ? usage.activeProducts.map((product) => <span className="badge" key={product}>{product}</span>) : <span className="muted">No active product sessions</span>}
          </div>
          <p className="fine-print" style={{ marginBottom: 0 }}>{usage.lastActiveAt ? `Last storage activity ${new Date(usage.lastActiveAt).toLocaleString("en-IN")}` : "No storage activity recorded yet."}</p>
        </section>
      </main>
    </AccountShell>
  );
}
