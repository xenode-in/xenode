import { createAccessControl } from "better-auth/plugins";

export const ORGANIZATION_FEATURE_FLAG = "ORGS_ENABLED";
export const PUBLIC_ORGANIZATION_FEATURE_FLAG = "NEXT_PUBLIC_ORGS_ENABLED";

export function isOrganizationFeatureEnabled(): boolean {
  return (
    process.env[ORGANIZATION_FEATURE_FLAG] === "true" ||
    process.env[PUBLIC_ORGANIZATION_FEATURE_FLAG] === "true"
  );
}

export const orgStatements = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
  file: ["read", "write", "delete", "share", "manage"],
  billing: ["read", "manage"],
} as const;

export const orgAccessControl = createAccessControl(orgStatements);

export const orgRoles = {
  owner: orgAccessControl.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
    file: ["read", "write", "delete", "share", "manage"],
    billing: ["read", "manage"],
  }),
  admin: orgAccessControl.newRole({
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["read"],
    file: ["read", "write", "delete", "share", "manage"],
    billing: ["read"],
  }),
  manager: orgAccessControl.newRole({
    organization: [],
    member: [],
    invitation: ["create", "cancel"],
    team: ["update"],
    ac: ["read"],
    file: ["read", "write", "delete", "share"],
    billing: [],
  }),
  member: orgAccessControl.newRole({
    organization: [],
    member: [],
    invitation: [],
    team: [],
    ac: ["read"],
    file: ["read", "write", "share"],
    billing: [],
  }),
  guest: orgAccessControl.newRole({
    organization: [],
    member: [],
    invitation: [],
    team: [],
    ac: [],
    file: ["read"],
    billing: [],
  }),
} as const;

export type OrgRole = keyof typeof orgRoles;

export function normalizeOrgRole(role: string | null | undefined): OrgRole {
  const firstRole = role?.split(",")[0]?.trim();
  if (
    firstRole === "owner" ||
    firstRole === "admin" ||
    firstRole === "manager" ||
    firstRole === "member" ||
    firstRole === "guest"
  ) {
    return firstRole;
  }
  return "member";
}
