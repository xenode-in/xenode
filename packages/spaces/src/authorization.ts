import type {
  ProductSlug,
  SpaceId,
  SpaceRole,
  SpaceType,
} from "@xenode/contracts";
import { getDatabase } from "@xenode/database/connection";
import { Space, type SpaceRecord } from "@xenode/database/models";

export type SpaceAction = "read" | "write" | "delete" | "share" | "manage";

export class SpaceAuthorizationError extends Error {
  constructor(
    public readonly status: 401 | 403 | 404,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SpaceAuthorizationError";
  }
}

export interface SpaceSnapshot {
  _id: string;
  type: SpaceType;
  ownerAccountId?: string;
  organizationId?: string;
  teamId?: string;
  status: "active" | "suspended" | "deleted";
}

export interface SpaceDirectory {
  findSpace(spaceId: string): Promise<SpaceSnapshot | null>;
  findOrganizationRole(
    accountId: string,
    organizationId: string,
  ): Promise<string | null>;
  isTeamMember(args: {
    accountId: string;
    organizationId: string;
    teamId: string;
  }): Promise<boolean>;
}

export interface SpaceAccess {
  accountId: string;
  spaceId: SpaceId;
  productId: ProductSlug;
  role: SpaceRole;
  space: SpaceSnapshot;
}

function normalizeRole(role: string | null): SpaceRole {
  if (
    role === "owner" ||
    role === "admin" ||
    role === "member" ||
    role === "guest"
  ) {
    return role;
  }
  throw new SpaceAuthorizationError(
    403,
    "unsupported_space_role",
    "Forbidden",
  );
}

function accountValues(accountId: string): unknown[] {
  const values: unknown[] = [accountId];
  const ObjectId = Space.db.base.mongo.ObjectId;
  if (ObjectId.isValid(accountId)) values.push(new ObjectId(accountId));
  return values;
}

export const mongoSpaceDirectory: SpaceDirectory = {
  async findSpace(spaceId) {
    return Space.findById(spaceId).lean<SpaceRecord>();
  },
  async findOrganizationRole(accountId, organizationId) {
    const member = await getDatabase().collection("member").findOne({
      userId: { $in: accountValues(accountId) },
      organizationId,
    });
    return typeof member?.role === "string" ? member.role : null;
  },
  async isTeamMember({ accountId, organizationId, teamId }) {
    const database = getDatabase();
    const [team, membership] = await Promise.all([
      database.collection("team").findOne({
        id: teamId,
        organizationId,
      }),
      database.collection("teamMember").findOne({
        userId: { $in: accountValues(accountId) },
        teamId,
      }),
    ]);
    return Boolean(team && membership);
  },
};

export async function resolveSpaceAccess(
  args: {
    accountId: string;
    spaceId: SpaceId;
    productId: ProductSlug;
  },
  directory: SpaceDirectory = mongoSpaceDirectory,
): Promise<SpaceAccess> {
  const space = await directory.findSpace(args.spaceId);
  if (!space || space.status !== "active") {
    throw new SpaceAuthorizationError(404, "space_not_found", "Space not found");
  }

  let role: SpaceRole;
  if (space.type === "personal") {
    if (space.ownerAccountId !== args.accountId) {
      throw new SpaceAuthorizationError(403, "space_access_denied", "Forbidden");
    }
    role = "owner";
  } else {
    if (!space.organizationId) {
      throw new SpaceAuthorizationError(404, "invalid_space", "Space not found");
    }
    role = normalizeRole(
      await directory.findOrganizationRole(
        args.accountId,
        space.organizationId,
      ),
    );
    if (
      space.type === "team" &&
      (!space.teamId ||
        !(await directory.isTeamMember({
          accountId: args.accountId,
          organizationId: space.organizationId,
          teamId: space.teamId,
        })))
    ) {
      throw new SpaceAuthorizationError(
        403,
        "team_membership_required",
        "Forbidden",
      );
    }
  }

  return { ...args, role, space };
}

export function assertSpaceAction(
  access: Pick<SpaceAccess, "role">,
  action: SpaceAction,
): void {
  if (action === "read") return;
  if (
    action === "write" &&
    (access.role === "owner" ||
      access.role === "admin" ||
      access.role === "member")
  ) {
    return;
  }
  if (
    (action === "delete" || action === "share" || action === "manage") &&
    (access.role === "owner" || access.role === "admin")
  ) {
    return;
  }
  throw new SpaceAuthorizationError(
    403,
    "space_role_required",
    "Forbidden",
  );
}
