"use client";

import { useMemo } from "react";
import { FilesBrowser } from "@/components/dashboard/FilesBrowser";
import { WorkspaceScopeProvider, type DriveScope } from "@/contexts/WorkspaceContext";
import type { OrgRole } from "@/lib/navigation/sidebar-nav";

export function OrgFilesClient({
  orgId,
  orgName,
  teamId,
  role,
}: {
  orgId: string;
  orgName: string;
  /** When set, the client operates on a team drive under the org. */
  teamId?: string;
  role?: OrgRole;
}) {
  const driveScope = useMemo<DriveScope>(
    () =>
      teamId
        ? { type: "team", orgId, teamId, orgName, role }
        : { type: "organization", orgId, orgName, role },
    [teamId, orgId, orgName, role],
  );

  return (
    <WorkspaceScopeProvider driveScope={driveScope}>
      <FilesBrowser />
    </WorkspaceScopeProvider>
  );
}
