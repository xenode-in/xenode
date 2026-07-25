"use client";

import { useEffect } from "react";
import { clearCachedAccountRootKey } from "@/lib/ark-cache";

/**
 * Canonical sign-out endpoint for the whole platform. Accounts' own sign-out
 * button and the Drive/Photos products all land here (top-level navigation) so
 * there is one place that:
 *   1. revokes every product session for the account,
 *   2. clears the Better Auth account session,
 *   3. drops the on-device cached Account Root Key,
 * then shows the login screen. This prevents the "sign out just SSO-logs me back
 * in" loop, since the account session is actually gone afterwards.
 */
export default function LogoutPage() {
  useEffect(() => {
    void (async () => {
      try {
        await fetch("/api/account/global-signout", {
          method: "POST",
          credentials: "include",
        });
      } catch {
        /* best effort */
      }
      try {
        await fetch("/api/auth/sign-out", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
      } catch {
        /* best effort */
      }
      await clearCachedAccountRootKey().catch(() => undefined);
      window.location.assign("/login");
    })();
  }, []);

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <p className="eyebrow">Xenode Account</p>
        <h1 style={{ fontSize: 28 }}>Signing you out…</h1>
        <p className="lede">Clearing your session on this device.</p>
      </section>
    </main>
  );
}
