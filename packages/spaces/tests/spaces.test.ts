import type { ProductSlug } from "@xenode/contracts";
import { describe, expect, it } from "vitest";
import {
  assertSpaceAction,
  resolveSpaceAccess,
  SpaceAuthorizationError,
  type SpaceDirectory,
  type SpaceSnapshot,
} from "../src";
import {
  organizationSpaceId,
  personalSpaceId,
  teamSpaceId,
} from "../src/ids";

function directory(args: {
  spaces: SpaceSnapshot[];
  roles?: Record<string, string>;
  teams?: string[];
}): SpaceDirectory {
  return {
    async findSpace(spaceId) {
      return args.spaces.find((space) => space._id === spaceId) ?? null;
    },
    async findOrganizationRole(accountId, organizationId) {
      return args.roles?.[`${accountId}:${organizationId}`] ?? null;
    },
    async isTeamMember({ accountId, teamId }) {
      return args.teams?.includes(`${accountId}:${teamId}`) ?? false;
    },
  };
}

const productId = "drive" as ProductSlug;

describe("space authorization", () => {
  it("creates stable product-neutral ids", () => {
    expect(personalSpaceId("acct_1")).toBe("space_personal_acct_1");
    expect(organizationSpaceId("org_1")).toBe("space_org_org_1");
    expect(teamSpaceId("org_1", "team_1")).toBe(
      "space_team_org_1_team_1",
    );
  });

  it("prevents another account from reaching a personal space", async () => {
    const spaceId = personalSpaceId("owner");
    await expect(
      resolveSpaceAccess(
        { accountId: "attacker", spaceId, productId },
        directory({
          spaces: [
            {
              _id: spaceId,
              type: "personal",
              ownerAccountId: "owner",
              status: "active",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "space_access_denied" });
  });

  it("re-derives organization membership and rejects manager", async () => {
    const spaceId = organizationSpaceId("org_1");
    await expect(
      resolveSpaceAccess(
        { accountId: "acct_1", spaceId, productId },
        directory({
          spaces: [
            {
              _id: spaceId,
              type: "organization",
              organizationId: "org_1",
              status: "active",
            },
          ],
          roles: { "acct_1:org_1": "manager" },
        }),
      ),
    ).rejects.toBeInstanceOf(SpaceAuthorizationError);
  });

  it("requires team membership independently of org membership", async () => {
    const spaceId = teamSpaceId("org_1", "team_1");
    await expect(
      resolveSpaceAccess(
        { accountId: "acct_1", spaceId, productId },
        directory({
          spaces: [
            {
              _id: spaceId,
              type: "team",
              organizationId: "org_1",
              teamId: "team_1",
              status: "active",
            },
          ],
          roles: { "acct_1:org_1": "member" },
        }),
      ),
    ).rejects.toMatchObject({ code: "team_membership_required" });
  });

  it("keeps guest read-only and member unable to manage", () => {
    expect(() => assertSpaceAction({ role: "guest" }, "read")).not.toThrow();
    expect(() => assertSpaceAction({ role: "guest" }, "write")).toThrow();
    expect(() => assertSpaceAction({ role: "member" }, "write")).not.toThrow();
    expect(() => assertSpaceAction({ role: "member" }, "manage")).toThrow();
  });
});
