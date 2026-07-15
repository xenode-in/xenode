export default function Page() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 64 }}>
      <a href="/" style={{ color: "#a1a1aa" }}>← Account</a>
      <h1>Security activity</h1>
      <p style={{ color: "#a1a1aa" }}>
        Review sign-ins, Vault mutations, key handoffs, and membership changes.
      </p>
      <a href="/security/vault">Manage encrypted Vault</a>
    </main>
  );
}
