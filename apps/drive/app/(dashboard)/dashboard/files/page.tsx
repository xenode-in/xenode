"use client";

import { WorkspaceScopeProvider, type DriveScope } from "@/contexts/WorkspaceContext";
import { FilesBrowser } from "@/components/dashboard/FilesBrowser";

// Personal drive is always personal-scoped, even when an organization is the
// active workspace — this keeps `/dashboard/files` from inheriting org scope.
const PERSONAL_SCOPE: DriveScope = { type: "personal" };

export default function FilesPage() {
  return (
    <WorkspaceScopeProvider driveScope={PERSONAL_SCOPE}>
      <FilesBrowser />
    </WorkspaceScopeProvider>
  );
}
