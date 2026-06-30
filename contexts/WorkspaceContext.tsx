"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { WorkspaceNav } from "@/lib/navigation/sidebar-nav";

interface WorkspaceContextValue {
  workspace: WorkspaceNav;
  /** Active org id, or null in the personal workspace. */
  activeOrgId: string | null;
  /**
   * `fetch` that flips Xenode's storage APIs into organization scope by adding
   * the `x-xenode-drive-scope` header when an org is active (see
   * `lib/authz/context.ts`). Pass-through in the personal workspace. Do NOT use
   * this for path-scoped `/api/orgs/[orgId]/*` routes — they ignore the header.
   */
  scopedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: WorkspaceNav;
  children: ReactNode;
}) {
  const activeOrgId =
    workspace.kind === "organization" ? workspace.orgId ?? null : null;

  const scopedFetch = useCallback(
    (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (!activeOrgId) return fetch(input, init);
      const headers = new Headers(init.headers);
      headers.set("x-xenode-drive-scope", "organization");
      return fetch(input, { ...init, headers });
    },
    [activeOrgId],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({ workspace, activeOrgId, scopedFetch }),
    [workspace, activeOrgId, scopedFetch],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}
