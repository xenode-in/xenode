"use client";

import { useState } from "react";

export function SignOutButton({
  className = "button button-secondary",
}: {
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        // Single canonical sign-out flow (revokes product sessions + account
        // session + clears the cached key), shared with Drive/Photos.
        window.location.assign("/logout");
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
