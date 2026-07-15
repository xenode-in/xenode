"use client";

import { useCallback, useEffect, useState } from "react";

type ProductSession = {
  sessionId: string;
  productId: string;
  authenticatedAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export default function DevicesPage() {
  const [sessions, setSessions] = useState<ProductSession[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/product-sessions", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      setError(response.status === 401 ? "Sign in to review sessions." : "Could not load sessions.");
      return;
    }
    const payload = (await response.json()) as { sessions: ProductSession[] };
    setSessions(payload.sessions);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(sessionId: string) {
    const response = await fetch("/api/product-sessions", {
      method: "DELETE",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (!response.ok) {
      setError("Could not revoke that session.");
      return;
    }
    await load();
  }

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 64 }}>
      <a href="/" style={{ color: "#a1a1aa" }}>← Account</a>
      <h1>Devices</h1>
      <p style={{ color: "#a1a1aa" }}>
        Review and revoke host-specific Drive, Photos, mobile, and office sessions.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <section style={{ display: "grid", gap: 12, marginTop: 24 }}>
        {sessions.map((item) => (
          <article
            key={item.sessionId}
            style={{ border: "1px solid #27272a", borderRadius: 12, padding: 16 }}
          >
            <strong>{item.productId}</strong>
            <p style={{ color: "#a1a1aa" }}>
              Signed in {new Date(item.authenticatedAt).toLocaleString()}
            </p>
            {item.revokedAt ? (
              <span>Revoked</span>
            ) : (
              <button type="button" onClick={() => void revoke(item.sessionId)}>
                Revoke
              </button>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
