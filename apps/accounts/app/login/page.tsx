"use client";

import { useState } from "react";
import { resumeAuthorizationPath } from "@/lib/presentation";

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const isEmail = identifier.includes("@");
    const endpoint = isEmail ? "/api/auth/sign-in/email" : "/api/auth/sign-in/username";
    const body = isEmail
      ? { email: identifier.trim().toLowerCase(), password, rememberMe }
      : { username: identifier.trim().toLowerCase(), password, rememberMe };
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setBusy(false);
      setMessage("Unable to sign in with those credentials.");
      return;
    }
    window.location.assign(resumeAuthorizationPath(new URLSearchParams(window.location.search)));
  }

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <p className="eyebrow">Xenode Account</p>
        <h1>Welcome back</h1>
        <p className="lede" style={{ marginBottom: 26 }}>Sign in with your Xenode email or username. External connectors cannot sign in to your account.</p>
        <form className="form" onSubmit={signIn}>
          <div className="field"><label htmlFor="identifier">Email or username</label><input className="input" id="identifier" required autoCapitalize="none" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></div>
          <div className="field"><label htmlFor="password">Password</label><input className="input" id="password" type="password" required minLength={8} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
          <label className="button-row fine-print"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /> Keep me signed in</label>
          {message ? <p className="status status-error" role="alert">{message}</p> : null}
          <button className="button" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        <p className="fine-print" style={{ marginTop: 20 }}>For privacy, incorrect email, username, and password attempts always receive the same response.</p>
      </section>
    </main>
  );
}
