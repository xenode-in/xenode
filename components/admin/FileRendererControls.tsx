"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RENDERER_KEYS, type RendererKey } from "@/lib/file-security/types";

type Key = RendererKey | "global";
type State = {
  environment: Record<Key, boolean>;
  killed: Partial<Record<Key, boolean>>;
  effective: Record<Key, boolean>;
  version: number;
  reason: string;
  updatedAt: string | null;
};

const KEYS: readonly Key[] = ["global", ...RENDERER_KEYS];

export function FileRendererControls() {
  const [state, setState] = useState<State | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<Key | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/security/file-renderers", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Failed to load renderer controls");
    setState(await response.json());
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "Failed to load"),
    );
  }, [load]);

  async function setKilled(renderer: Key, killed: boolean) {
    if (reason.trim().length < 8) {
      setError("Enter a reason of at least 8 characters.");
      return;
    }
    setBusy(renderer);
    setError("");
    try {
      const response = await fetch("/api/admin/security/file-renderers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ renderer, killed, reason }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Update failed");
      setState(body);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  if (!state) {
    return <p className="text-sm text-muted-foreground">{error || "Loading..."}</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <ShieldAlert className="h-5 w-5 shrink-0 text-amber-500" />
        <p className="text-sm text-muted-foreground">
          Environment flags only approve a renderer. This control can disable an
          approved renderer immediately, but cannot enable one that deployment
          configuration has not approved.
        </p>
      </div>
      <label className="block space-y-2">
        <span className="text-sm font-medium">Operational reason</span>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          placeholder="Required for the immutable audit event"
          maxLength={500}
        />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40">
            <tr>
              <th className="px-4 py-3 text-left">Renderer</th>
              <th className="px-4 py-3 text-left">Environment</th>
              <th className="px-4 py-3 text-left">Effective</th>
              <th className="px-4 py-3 text-right">Emergency control</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {KEYS.map((key) => (
              <tr key={key}>
                <td className="px-4 py-3 font-medium">{key}</td>
                <td className="px-4 py-3">{state.environment[key] ? "approved" : "disabled"}</td>
                <td className="px-4 py-3">{state.effective[key] ? "enabled" : "disabled"}</td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="sm"
                    variant={state.killed[key] ? "outline" : "destructive"}
                    disabled={busy !== null}
                    onClick={() => void setKilled(key, !state.killed[key])}
                  >
                    {state.killed[key] ? "Clear kill" : "Kill now"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Configuration version {state.version}. Last reason: {state.reason}
      </p>
    </div>
  );
}
