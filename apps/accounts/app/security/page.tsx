import { AccountShell } from "@/components/AccountShell";
import { loadSecurityActivity } from "@/lib/hub-data";
import { requireUnlockedAccountsPageSession } from "@/lib/session";

export default async function SecurityPage() {
  const session = await requireUnlockedAccountsPageSession("/security");
  const activity = await loadSecurityActivity(session.user.id);
  return (
    <AccountShell user={session.user}>
      <main className="page">
        <p className="eyebrow">Audit trail</p>
        <h1>Security activity</h1>
        <p className="lede">The latest account sign-ins, Vault mutations, key handoffs, and product-session changes. Event metadata shown here never includes keys or plaintext filenames.</p>
        <div className="button-row" style={{ marginTop: 24 }}>
          <a className="button" href="/security/vault" style={{ textDecoration: "none" }}>Manage encrypted Vault</a>
          <a className="button button-secondary" href="/devices" style={{ textDecoration: "none" }}>Review devices</a>
        </div>
        <section className="card" style={{ marginTop: 32 }}>
          {activity.length ? <div className="timeline">{activity.map((event) => (
            <article className="timeline-item" key={event.id}>
              <span className="timeline-dot" aria-hidden="true" />
              <div><strong>{event.label}</strong><p className="fine-print">{event.productId ? `Product: ${event.productId}` : "Account authority"}{event.spaceId ? ` · Space: ${event.spaceId}` : ""}</p></div>
              <time className="fine-print" dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}</time>
            </article>
          ))}</div> : <div className="empty">No security events have been recorded yet.</div>}
        </section>
      </main>
    </AccountShell>
  );
}
