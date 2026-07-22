"use client";

import { useState } from "react";

type Profile = {
  name: string;
  email: string;
  username: string;
  displayUsername: string;
  emailVerified: boolean;
  defaultEncrypt: boolean;
  createdAt: string | null;
};

export function ProfileForm({ initialProfile }: { initialProfile: Profile }) {
  const [name, setName] = useState(initialProfile.name);
  const [username, setUsername] = useState(initialProfile.username);
  const [defaultEncrypt, setDefaultEncrypt] = useState(initialProfile.defaultEncrypt);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    setError(false);
    const response = await fetch("/api/profile", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, username, defaultEncrypt }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!response.ok) {
      setError(true);
      setStatus(payload?.error ?? "Could not update your profile.");
      return;
    }
    setStatus("Profile updated.");
  }

  return (
    <form className="form" onSubmit={save}>
      <div className="field">
        <label htmlFor="name">Display name</label>
        <input className="input" id="name" value={name} minLength={1} maxLength={80} autoComplete="name" onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="username">Username</label>
        <input className="input" id="username" value={username} minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]+" autoCapitalize="none" autoComplete="username" onChange={(event) => setUsername(event.target.value)} />
        <span className="fine-print">Lowercase letters, numbers, underscores, and periods. Reserved system names are blocked.</span>
      </div>
      <div className="field">
        <label htmlFor="email">Verified email</label>
        <input className="input" id="email" value={initialProfile.email} disabled />
        <span className="fine-print">{initialProfile.emailVerified ? "Verified" : "Verification pending"}</span>
      </div>
      <label className="button-row">
        <input type="checkbox" checked={defaultEncrypt} onChange={(event) => setDefaultEncrypt(event.target.checked)} />
        Encrypt new content by default
      </label>
      {status ? <p className={`status${error ? " status-error" : ""}`} role="status">{status}</p> : null}
      <div className="button-row"><button className="button" disabled={busy} type="submit">{busy ? "Saving…" : "Save profile"}</button></div>
    </form>
  );
}
