import type { ClientSession } from "mongoose";
import type { ProductSlug } from "@xenode/contracts";
import {
  SpaceProductKey,
  type SpaceProductKeyRecord,
} from "@xenode/database/models";

export type KeyRotationReason =
  | "initial"
  | "member_added"
  | "member_removed"
  | "manual";

export type MemberKeyStatus = SpaceProductKeyRecord["status"];

export interface PutMemberProductKeyInput {
  spaceId: string;
  productId?: ProductSlug;
  memberAccountId: string;
  wrappedKey: string;
  keyVersion: number;
  createdByAccountId: string;
  rotationReason?: KeyRotationReason;
  status?: Extract<MemberKeyStatus, "pending" | "active">;
  session?: ClientSession;
}

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export function spaceProductKeyEnvelopeId(args: {
  spaceId: string;
  productId: ProductSlug;
  memberAccountId: string;
  keyVersion: number;
}): string {
  return [
    "spk",
    nonEmpty(args.spaceId, "spaceId"),
    args.productId,
    nonEmpty(args.memberAccountId, "memberAccountId"),
    `v${args.keyVersion}`,
  ].join(":");
}

export async function putMemberProductKey(
  input: PutMemberProductKeyInput,
): Promise<SpaceProductKeyRecord | null> {
  const productId = input.productId ?? "drive";
  const wrappedKey = nonEmpty(input.wrappedKey, "wrappedKey");
  if (!Number.isInteger(input.keyVersion) || input.keyVersion < 1) {
    throw new Error("keyVersion must be a positive integer");
  }
  const _id = spaceProductKeyEnvelopeId({
    spaceId: input.spaceId,
    productId,
    memberAccountId: input.memberAccountId,
    keyVersion: input.keyVersion,
  });
  return SpaceProductKey.findOneAndUpdate(
    { _id },
    {
      $set: {
        spaceId: input.spaceId,
        productId,
        memberAccountId: input.memberAccountId,
        keyVersion: input.keyVersion,
        formatVersion: 2,
        algorithm: "RSA-OAEP-256",
        ciphertext: wrappedKey,
        aadVersion: 1,
        status: input.status ?? "active",
        createdByAccountId: input.createdByAccountId,
        ...(input.rotationReason
          ? { rotationReason: input.rotationReason }
          : {}),
      },
      $unset: { iv: "" },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      ...(input.session ? { session: input.session } : {}),
    },
  ).lean<SpaceProductKeyRecord>();
}

export async function listMemberProductKeys(args: {
  spaceId: string;
  memberAccountId: string;
  productId?: ProductSlug;
}): Promise<SpaceProductKeyRecord[]> {
  return SpaceProductKey.find({
    spaceId: args.spaceId,
    productId: args.productId ?? "drive",
    memberAccountId: args.memberAccountId,
    status: "active",
  })
    .sort({ keyVersion: -1, createdAt: -1 })
    .lean<SpaceProductKeyRecord[]>();
}

export async function getMemberProductKey(args: {
  spaceId: string;
  memberAccountId: string;
  keyVersion: number;
  productId?: ProductSlug;
  statuses?: MemberKeyStatus[];
}): Promise<SpaceProductKeyRecord | null> {
  return SpaceProductKey.findOne({
    _id: spaceProductKeyEnvelopeId({
      spaceId: args.spaceId,
      productId: args.productId ?? "drive",
      memberAccountId: args.memberAccountId,
      keyVersion: args.keyVersion,
    }),
    status: { $in: args.statuses ?? ["pending", "active"] },
  }).lean<SpaceProductKeyRecord>();
}

export async function setMemberProductKeyStatus(args: {
  spaceId: string;
  memberAccountId: string;
  keyVersion: number;
  status: MemberKeyStatus;
  productId?: ProductSlug;
  rotationReason?: KeyRotationReason;
  session?: ClientSession;
}): Promise<SpaceProductKeyRecord | null> {
  return SpaceProductKey.findOneAndUpdate(
    {
      _id: spaceProductKeyEnvelopeId({
        spaceId: args.spaceId,
        productId: args.productId ?? "drive",
        memberAccountId: args.memberAccountId,
        keyVersion: args.keyVersion,
      }),
    },
    {
      $set: {
        status: args.status,
        ...(args.rotationReason
          ? { rotationReason: args.rotationReason }
          : {}),
      },
    },
    {
      new: true,
      runValidators: true,
      ...(args.session ? { session: args.session } : {}),
    },
  ).lean<SpaceProductKeyRecord>();
}
export async function latestProductKeyVersion(args: {
  spaceId: string;
  productId?: ProductSlug;
}): Promise<number> {
  const key = await SpaceProductKey.findOne({
    spaceId: args.spaceId,
    productId: args.productId ?? "drive",
    status: { $in: ["pending", "active"] },
  })
    .sort({ keyVersion: -1 })
    .select("keyVersion")
    .lean<{ keyVersion: number }>();
  return key?.keyVersion ?? 0;
}

export async function revokeMemberProductKeys(args: {
  spaceIds: string | string[];
  memberAccountId: string;
  productId?: ProductSlug;
  productIds?: ProductSlug[];
  rotationReason?: KeyRotationReason;
  session?: ClientSession;
}) {
  return SpaceProductKey.updateMany(
    {
      spaceId: { $in: Array.isArray(args.spaceIds) ? args.spaceIds : [args.spaceIds] },
      productId: args.productIds?.length
        ? { $in: args.productIds }
        : (args.productId ?? "drive"),
      memberAccountId: args.memberAccountId,
      status: { $in: ["pending", "active"] },
    },
    {
      $set: {
        status: "revoked",
        ...(args.rotationReason
          ? { rotationReason: args.rotationReason }
          : {}),
      },
    },
    args.session ? { session: args.session } : undefined,
  );
}

export async function retireOlderProductKeys(args: {
  spaceId: string;
  memberAccountIds: string[];
  keyVersion: number;
  productId?: ProductSlug;
  rotationReason?: KeyRotationReason;
  session?: ClientSession;
}) {
  if (args.memberAccountIds.length === 0) return null;
  return SpaceProductKey.updateMany(
    {
      spaceId: args.spaceId,
      productId: args.productId ?? "drive",
      memberAccountId: { $in: args.memberAccountIds },
      keyVersion: { $lt: args.keyVersion },
      status: "active",
    },
    {
      $set: {
        status: "retired",
        ...(args.rotationReason
          ? { rotationReason: args.rotationReason }
          : {}),
      },
    },
    args.session ? { session: args.session } : undefined,
  );
}

export async function deleteSpaceProductKeys(args: {
  spaceId: string;
  session?: ClientSession;
}) {
  return SpaceProductKey.deleteMany(
    { spaceId: args.spaceId },
    args.session ? { session: args.session } : undefined,
  );
}
