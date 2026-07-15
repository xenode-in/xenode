import { Space, type SpaceRecord } from "@xenode/database/models";
import {
  organizationSpaceId,
  personalSpaceId,
  teamSpaceId,
} from "./ids";

async function upsertSpace(
  record: Omit<SpaceRecord, "createdAt" | "updatedAt">,
): Promise<SpaceRecord> {
  await Space.updateOne(
    { _id: record._id },
    { $setOnInsert: record },
    { upsert: true },
  );
  const space = await Space.findById(record._id).lean<SpaceRecord>();
  if (!space) throw new Error("Failed to create space");
  return space;
}

export function ensurePersonalSpace(accountId: string): Promise<SpaceRecord> {
  return upsertSpace({
    _id: personalSpaceId(accountId),
    type: "personal",
    ownerAccountId: accountId,
    status: "active",
    createdByAccountId: accountId,
  });
}

export function ensureOrganizationSpace(args: {
  accountId: string;
  organizationId: string;
}): Promise<SpaceRecord> {
  return upsertSpace({
    _id: organizationSpaceId(args.organizationId),
    type: "organization",
    organizationId: args.organizationId,
    status: "active",
    createdByAccountId: args.accountId,
  });
}

export function ensureTeamSpace(args: {
  accountId: string;
  organizationId: string;
  teamId: string;
}): Promise<SpaceRecord> {
  return upsertSpace({
    _id: teamSpaceId(args.organizationId, args.teamId),
    type: "team",
    organizationId: args.organizationId,
    teamId: args.teamId,
    status: "active",
    createdByAccountId: args.accountId,
  });
}
