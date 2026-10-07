"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/** Makes `orgId` the active workspace, then opens its files (deep links from Accounts). */
export function OpenOrganization({ orgId }: { orgId: string }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/orgs/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId }),
    }).then(
      (res) => {
        if (res.ok) window.location.replace(new URL("/dashboard/org/files", window.location.href));
        else setError("This organization could not be opened.");
      },
      () => setError("This organization could not be opened."),
    );
  }, [orgId]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
      {error ?? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Opening organization…
        </>
      )}
    </div>
  );
}
