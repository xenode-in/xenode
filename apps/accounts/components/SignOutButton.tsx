"use client";

import { useState } from "react";
import { clearCachedAccountRootKey } from "@/lib/ark-cache";

export function SignOutButton({
  className = "button button-secondary",
}: {
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    } catch {
      /* fall through — still clear local key material + redirect */
    }
    // Truly de-authorize this browser: drop the cached Account Root Key so the
    // key-handoff broker can't silently re-unlock Drive/Photos after sign-out.
    await clearCachedAccountRootKey().catch(() => undefined);
    window.location.assign("/login");
  }
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={() => void signOut()}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
