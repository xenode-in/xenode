import { AccountShell } from "@/components/AccountShell";
import { SignOutButton } from "@/components/SignOutButton";
import { requireAccountsPageSession } from "@/lib/session";

const sections = [
  ["Profile", "/profile", "Name, username, verified email, and encryption defaults"],
  ["Linked accounts", "/linked-accounts", "External connectors kept separate from your login identity"],
  ["Security activity", "/security", "Recent sign-ins, Vault changes, and product handoffs"],
  ["Devices", "/devices", "Active Drive, Photos, mobile, and office sessions"],
  ["Organizations", "/organizations", "Memberships, roles, and organization workspaces"],
  ["Usage", "/usage", "Read-only storage, plan, and product statistics"],
] as const;

export default async function AccountsHome() {
  const session = await requireAccountsPageSession();
  return (
    <AccountShell user={session.user}>
      <main className="page">
        <p className="eyebrow">Xenode Account</p>
        <h1>Your identity.<br />One secure place.</h1>
        <p className="lede">
          Manage identity and security here. Drive and Photos keep separate,
          host-only sessions and receive only the key for the product space you open.
        </p>
        <div className="button-row" style={{ marginTop: 24 }}>
          <SignOutButton />
        </div>
        <section className="grid grid-3" style={{ marginTop: 44 }}>
          {sections.map(([title, href, description]) => (
            <a className="card link-card" key={href} href={href}>
              <h2>{title}</h2>
              <p>{description}</p>
              <span className="arrow">Open →</span>
            </a>
          ))}
        </section>
      </main>
    </AccountShell>
  );
}
