"use client";

import { useState } from "react";

type ProductSession = {
  sessionId: string;
  productId: string;
  authenticatedAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export function DevicesList({ initialSessions }: { initialSessions: ProductSession[] }) {
  const [sessions, setSessions] = useState(initialSessions);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function revoke(sessionId: string) {
    setBusy(sessionId);
    setError("");
    const response = await fetch("/api/product-sessions", {
      method: "DELETE",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    setBusy(null);
    if (!response.ok) {
      setError("Could not revoke that session.");
      return;
    }
    const payload = (await response.json()) as { revokedAt: string };
    setSessions((current) => current.map((item) => item.sessionId === sessionId ? { ...item, revokedAt: payload.revokedAt } : item));
  }

  return (
    <section className="grid grid-2" style={{ marginTop: 32 }}>
      {error ? <p className="status status-error" role="alert" style={{ gridColumn: "1 / -1" }}>{error}</p> : null}
      {sessions.length ? sessions.map((item) => (
        <article className="card" key={item.sessionId}>
          <div className="button-row" style={{ justifyContent: "space-between" }}><h2 style={{ textTransform: "capitalize" }}>{item.productId}</h2><span className="badge">{item.revokedAt ? "Revoked" : "Active"}</span></div>
          <p className="fine-print">Signed in {new Date(item.authenticatedAt).toLocaleString("en-IN")}</p>
          <p className="fine-print">Expires {new Date(item.expiresAt).toLocaleString("en-IN")}</p>
          {!item.revokedAt ? <button className="button button-danger" type="button" disabled={busy === item.sessionId} onClick={() => void revoke(item.sessionId)}>{busy === item.sessionId ? "Revoking…" : "Revoke session"}</button> : null}
        </article>
      )) : <div className="empty" style={{ gridColumn: "1 / -1" }}>No active product sessions.</div>}
    </section>
  );
}
