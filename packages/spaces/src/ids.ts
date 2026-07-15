import type { SpaceId } from "@xenode/contracts";

function assertIdentityPart(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new Error(`${label} must contain between 1 and 200 characters`);
  }
  return encodeURIComponent(normalized);
}

export function personalSpaceId(accountId: string): SpaceId {
  return `space_personal_${assertIdentityPart(accountId, "accountId")}` as SpaceId;
}

export function organizationSpaceId(organizationId: string): SpaceId {
  return `space_org_${assertIdentityPart(organizationId, "organizationId")}` as SpaceId;
}

export function teamSpaceId(organizationId: string, teamId: string): SpaceId {
  return `space_team_${assertIdentityPart(organizationId, "organizationId")}_${assertIdentityPart(teamId, "teamId")}` as SpaceId;
}
