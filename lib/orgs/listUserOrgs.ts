import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import {
  isOrganizationFeatureEnabled,
  normalizeOrgRole,
  type OrgRole,
} from "@/lib/auth/organization";

export interface UserOrgSummary {
  id: string;
  name: string;
  slug: string | null;
  logo: string | null;
  role: OrgRole;
  isActive: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface MemberRow {
  organizationId: string;
  userId: string;
  role?: string | null;
  createdAt?: Date;
}

interface OrgRow {
  id: string;
  name: string;
  slug?: string | null;
  logo?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * List the organizations the user belongs to, newest membership first, with the
 * caller's role and which one is currently active. Shared by `GET /api/orgs`
 * and server components (the dashboard layout) so SSR avoids an internal HTTP
 * round-trip. Returns `[]` when the org feature is disabled.
 */
export async function listUserOrgs(
  userId: string,
  activeOrgId?: string | null,
): Promise<UserOrgSummary[]> {
  if (!isOrganizationFeatureEnabled()) return [];

  await dbConnect();
  const members = await mongoose.connection
    .collection<MemberRow>("member")
    .find({ userId })
    .sort({ createdAt: -1 })
    .toArray();

  const orgIds = members.map((member) => member.organizationId);
  if (orgIds.length === 0) return [];

  const orgs = await mongoose.connection
    .collection<OrgRow>("organization")
    .find({ id: { $in: orgIds } })
    .toArray();
  const orgById = new Map(orgs.map((org) => [org.id, org]));

  return members
    .map((member): UserOrgSummary | null => {
      const org = orgById.get(member.organizationId);
      if (!org) return null;
      return {
        id: org.id,
        name: org.name,
        slug: org.slug ?? null,
        logo: org.logo ?? null,
        role: normalizeOrgRole(member.role),
        isActive: activeOrgId === org.id,
        createdAt: org.createdAt ?? null,
        updatedAt: org.updatedAt ?? null,
      };
    })
    .filter((entry): entry is UserOrgSummary => entry !== null);
}
