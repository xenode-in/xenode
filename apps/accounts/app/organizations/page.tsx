import { AccountShell } from "@/components/AccountShell";
import { loadOrganizations } from "@/lib/hub-data";
import { requireAccountsPageSession } from "@/lib/session";

export default async function OrganizationsPage() {
  const session = await requireAccountsPageSession();
  const organizations = await loadOrganizations(session.user.id);
  const driveOrigin = process.env.DRIVE_ORIGIN ?? "https://drive.xenode.in";
  return (
    <AccountShell user={session.user}>
      <main className="page">
        <p className="eyebrow">Workspaces</p>
        <h1>Organizations</h1>
        <p className="lede">Your personal identity remains independent of every organization. Membership changes never claim or replace your personal account.</p>
        <section className="grid grid-2" style={{ marginTop: 32 }}>
          {organizations.length ? organizations.map((organization) => (
            <article className="card" key={organization.id}>
              <div className="button-row" style={{ justifyContent: "space-between" }}><h2>{organization.name}</h2><span className="badge">{organization.role}</span></div>
              <p className="muted">{organization.slug ? `@${organization.slug}` : "Private organization"}</p>
              <p className="fine-print">{organization.joinedAt ? `Joined ${new Date(organization.joinedAt).toLocaleDateString("en-IN")}` : "Active membership"}</p>
              <a className="button button-secondary" href={`${driveOrigin}/dashboard/org`} style={{ display: "inline-block", textDecoration: "none" }}>Open in Drive</a>
            </article>
          )) : <div className="empty" style={{ gridColumn: "1 / -1" }}>You are not a member of an organization. Your personal Space remains available in Drive and Photos.</div>}
        </section>
      </main>
    </AccountShell>
  );
}
