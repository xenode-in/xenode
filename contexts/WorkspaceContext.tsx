"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { WorkspaceNav } from "@/lib/navigation/sidebar-nav";

export type DriveScope =
  | { type: "personal" }
  | {
      type: "organization";
      orgId: string;
      orgName?: string;
      role?: WorkspaceNav["role"];
    }
  | {
      type: "team";
      orgId: string;
      teamId: string;
      orgName?: string;
      role?: WorkspaceNav["role"];
    };

interface WorkspaceContextValue {
  workspace: WorkspaceNav;
  driveScope: DriveScope;
  activeOrgId: string | null;
  activeTeamId: string | null;
  scopedHeaders: (headers?: HeadersInit) => Headers;
  scopedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /**
   * Publish the currently-open drive scope to the top-level provider so that
   * app-wide providers mounted above the per-page scope (Upload/Download/
   * Preview) observe team/org scope too. Set by `WorkspaceScopeProvider`.
   */
  setActiveDriveScope: (scope: DriveScope) => void;
  /** The scope to fall back to when a scoped surface unmounts. */
  defaultDriveScope: DriveScope;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** Stable string identity for a scope — used as an effect dependency. */
function driveScopeKey(scope: DriveScope): string {
  if (scope.type === "team") return `team:${scope.orgId}:${scope.teamId}`;
  if (scope.type === "organization") return `org:${scope.orgId}`;
  return "personal";
}

function scopeFromWorkspace(workspace: WorkspaceNav): DriveScope {
  if (workspace.kind !== "organization" || !workspace.orgId) {
    return { type: "personal" };
  }
  return {
    type: "organization",
    orgId: workspace.orgId,
    orgName: workspace.orgName,
    role: workspace.role,
  };
}

function withDriveScope(headers: HeadersInit | undefined, scope: DriveScope): Headers {
  const next = new Headers(headers);
  if (scope.type === "personal") {
    next.delete("x-xenode-drive-scope");
    next.delete("x-xenode-team-id");
    return next;
  }

  next.set("x-xenode-drive-scope", scope.type);
  if (scope.type === "team") {
    next.set("x-xenode-team-id", scope.teamId);
  } else {
    next.delete("x-xenode-team-id");
  }
  return next;
}

function WorkspaceValueProvider({
  workspace,
  driveScope,
  setActiveDriveScope,
  defaultDriveScope,
  children,
}: {
  workspace: WorkspaceNav;
  driveScope: DriveScope;
  setActiveDriveScope: (scope: DriveScope) => void;
  defaultDriveScope: DriveScope;
  children: ReactNode;
}) {
  const activeOrgId =
    driveScope.type === "personal" ? null : driveScope.orgId;
  const activeTeamId =
    driveScope.type === "team" ? driveScope.teamId : null;

  const scopedHeaders = useCallback(
    (headers?: HeadersInit) => withDriveScope(headers, driveScope),
    [driveScope],
  );

  const scopedFetch = useCallback(
    (input: RequestInfo | URL, init: RequestInit = {}) => {
      return fetch(input, { ...init, headers: scopedHeaders(init.headers) });
    },
    [scopedHeaders],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspace,
      driveScope,
      activeOrgId,
      activeTeamId,
      scopedHeaders,
      scopedFetch,
      setActiveDriveScope,
      defaultDriveScope,
    }),
    [
      workspace,
      driveScope,
      activeOrgId,
      activeTeamId,
      scopedHeaders,
      scopedFetch,
      setActiveDriveScope,
      defaultDriveScope,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: WorkspaceNav;
  children: ReactNode;
}) {
  const defaultDriveScope = useMemo(
    () => scopeFromWorkspace(workspace),
    [workspace],
  );
  const [activeDriveScope, setActiveDriveScope] =
    useState<DriveScope>(defaultDriveScope);

  // When the active workspace itself changes (e.g. switching orgs via the
  // switcher), snap the scope back to that workspace's default.
  useEffect(() => {
    setActiveDriveScope(defaultDriveScope);
  }, [defaultDriveScope]);

  return (
    <WorkspaceValueProvider
      workspace={workspace}
      driveScope={activeDriveScope}
      setActiveDriveScope={setActiveDriveScope}
      defaultDriveScope={defaultDriveScope}
    >
      {children}
    </WorkspaceValueProvider>
  );
}

/**
 * Re-scope a file surface (personal / org / team). Renders a synchronous nested
 * provider so its children read the right scope on the first render (no
 * wrong-scope fetch flash), and mirrors the scope up to the top-level provider
 * via an effect so app-wide Upload/Download/Preview providers see it too.
 */
export function WorkspaceScopeProvider({
  driveScope,
  children,
}: {
  driveScope: DriveScope;
  children: ReactNode;
}) {
  const parent = useWorkspace();
  const { setActiveDriveScope, defaultDriveScope } = parent;
  const scopeKey = driveScopeKey(driveScope);

  useEffect(() => {
    setActiveDriveScope(driveScope);
    return () => setActiveDriveScope(defaultDriveScope);
    // `driveScope` is captured via its stable `scopeKey`; the closure always
    // sees the latest value for a given key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, setActiveDriveScope, defaultDriveScope]);

  return (
    <WorkspaceValueProvider
      workspace={parent.workspace}
      driveScope={driveScope}
      setActiveDriveScope={setActiveDriveScope}
      defaultDriveScope={defaultDriveScope}
    >
      {children}
    </WorkspaceValueProvider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}

export function useOptionalWorkspace(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}
