"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  ONLYOFFICE_ARTIFACT_VERSION,
  ONLYOFFICE_EDITOR_URL,
} from "@/lib/spreadsheets/v2/config";

type RuntimeState =
  | { status: "checking" }
  | { status: "ready"; version: string; bridgeReady: boolean; x2tReady: boolean }
  | { status: "missing"; message: string };

export function OnlyOfficeRuntimeStatus() {
  const [runtime, setRuntime] = useState<RuntimeState>({ status: "checking" });

  const checkRuntime = useCallback(async () => {
    setRuntime({ status: "checking" });
    try {
      const response = await fetch(`${ONLYOFFICE_EDITOR_URL}/version.json`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setRuntime({
          status: "missing",
          message: "The versioned browser artifact has not been built yet.",
        });
        return;
      }
      const manifest = (await response.json()) as {
        xenode?: string;
        onlyoffice?: string;
        bridgeReady?: boolean;
        x2tReady?: boolean;
      };
      setRuntime({
        status: "ready",
        version: manifest.xenode ?? manifest.onlyoffice ?? ONLYOFFICE_ARTIFACT_VERSION,
        bridgeReady: manifest.bridgeReady === true,
        x2tReady: manifest.x2tReady === true,
      });
    } catch {
      setRuntime({
        status: "missing",
        message: "The versioned browser artifact is unavailable.",
      });
    }
  }, []);

  useEffect(() => {
    void checkRuntime();
  }, [checkRuntime]);

  const ready = runtime.status === "ready";

  return (
    <section className="w-full max-w-5xl rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-col gap-4 border-b p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-600">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h2 className="font-semibold">Official ONLYOFFICE browser runtime</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Document and spreadsheet bundles, isolated from the current Univer editor.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void checkRuntime()}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          <RefreshCw className="size-4" />
          Recheck
        </button>
      </div>

      <div className="grid gap-4 p-6 md:grid-cols-3">
        <StatusCard
          title="Client assets"
          state={runtime.status === "checking" ? "checking" : ready ? "ready" : "pending"}
          detail={
            runtime.status === "ready"
              ? runtime.version
              : runtime.status === "missing"
                ? runtime.message
                : "Checking immutable artifact"
          }
        />
        <StatusCard
          title="Browser conversion"
          state={
            runtime.status === "checking"
              ? "checking"
              : runtime.status === "ready" && runtime.x2tReady
                ? "ready"
                : "pending"
          }
          detail={
            runtime.status === "ready" && runtime.x2tReady
              ? "x2t WASM engine available"
              : "Run npm run onlyoffice:build-x2t to compile x2t WASM"
          }
        />
        <StatusCard
          title="E2EE bridge"
          state={
            runtime.status === "checking"
              ? "checking"
              : runtime.status === "ready" && runtime.bridgeReady
                ? "ready"
                : "pending"
          }
          detail={
            runtime.status === "ready" && runtime.bridgeReady
              ? "Typed iframe bridge installed"
              : "Run npm run onlyoffice:install-host"
          }
        />
      </div>

      {!ready && runtime.status !== "checking" && (
        <div className="mx-6 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <div className="flex gap-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">Build the first client artifact</p>
              <code className="mt-2 block rounded bg-background px-3 py-2 text-xs">
                npm run onlyoffice:build-client
              </code>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function StatusCard({
  title,
  state,
  detail,
}: {
  title: string;
  state: "ready" | "pending" | "checking";
  detail: string;
}) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="flex items-center gap-2">
        {state === "ready" ? (
          <CheckCircle2 className="size-4 text-emerald-600" />
        ) : state === "checking" ? (
          <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <span className="size-2 rounded-full bg-amber-500" />
        )}
        <p className="text-sm font-medium">{title}</p>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}
