"use client";

import { useState } from "react";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/sign-out", { method: "POST", credentials: "include" });
    window.location.assign("/login");
  }
  return <button className="button button-secondary" disabled={busy} onClick={() => void signOut()}>{busy ? "Signing out…" : "Sign out"}</button>;
}
