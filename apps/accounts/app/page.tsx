const sections = [
  ["Profile", "/profile", "Name, username, email, and preferences"],
  ["Linked accounts", "/linked-accounts", "Connectors for external services; never login identities"],
  ["Security activity", "/security", "Recent sign-ins and sensitive account events"],
  ["Devices", "/devices", "Product sessions and device revocation"],
  ["Organizations", "/organizations", "Membership, domains, and organization security"],
  ["Usage", "/usage", "Read-only storage and plan statistics"],
] as const;

export default function AccountsHome() {
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "64px 24px" }}>
      <p style={{ color: "#a1a1aa" }}>Xenode Account</p>
      <h1 style={{ fontSize: 42, margin: "8px 0" }}>Your account, one secure place</h1>
      <p style={{ color: "#a1a1aa", maxWidth: 680 }}>
        Manage identity and security here. Drive and Photos keep separate host-only sessions and receive only their product-space keys.
      </p>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16, marginTop: 40 }}>
        {sections.map(([title, href, description]) => (
          <a key={href} href={href} style={{ color: "inherit", textDecoration: "none", border: "1px solid #27272a", borderRadius: 16, padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>{title}</h2>
            <p style={{ color: "#a1a1aa" }}>{description}</p>
          </a>
        ))}
      </section>
    </main>
  );
}
