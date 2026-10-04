import type { ClientSession } from "mongoose";
import type { ProductSlug } from "@xenode/contracts";
import {
  Space,
  SpaceProductKey,
  type SpaceProductKeyRecord,
} from "@xenode/database/models";

export type KeyRotationReason =
  | "initial"
  | "member_added"
  | "member_removed"
  | "manual";

export type MemberKeyStatus = SpaceProductKeyRecord["status"];

/** A refused grant operation; routes map it to an HTTP response. */
export class ProductKeyGrantError extends Error {
  constructor(
    public readonly status: 400 | 409,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductKeyGrantError";
  }
}

/** One wrapped Space key version for one member. */
export interface KeyringGrant {
  keyVersion: number;
  wrappedKey: string;
}

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

/**
 * Create-only: a member's grant for a key version never changes while it is
 * pending or active, so nobody can substitute a different key under an
 * existing version. A revoked or retired grant (former member, cancelled
 * invitation) may be replaced when the member is admitted again.
 */
export async function putMemberProductKey(
  input: PutMemberProductKeyInput,
): Promise<SpaceProductKeyRecord> {
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
  const now = new Date();
  const record: SpaceProductKeyRecord = {
    _id,
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
    ...(input.rotationReason ? { rotationReason: input.rotationReason } : {}),
    createdAt: now,
    updatedAt: now,
  };
  const options = input.session ? { session: input.session } : {};
  const replaced = await SpaceProductKey.replaceOne(
    { _id, status: { $in: ["revoked", "retired"] } },
    record,
    options,
  );
  if (replaced.matchedCount === 0) {
    try {
      await SpaceProductKey.create([record], options);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ProductKeyGrantError(
          409,
          "product_key_grant_exists",
          "This member already holds this key version",
        );
      }
      throw error;
    }
  }
  return record;
}

/**
 * Every grant-changing transaction writes this first, so concurrent
 * rotations, invitations and additions conflict and retry against fresh
 * state instead of leaving a keyholder without a version.
 */
export async function fenceSpaceKeyring(args: { spaceId: string; session: ClientSession }) {
  const fenced = await Space.updateOne(
    { _id: args.spaceId },
    { $inc: { keyringFenceVersion: 1 } },
    { session: args.session },
  );
  if (fenced.matchedCount !== 1) {
    throw new ProductKeyGrantError(409, "space_unavailable", "Space is unavailable");
  }
}

/** Every key version the Space has issued, ascending. Content may use any. */
export async function productKeyVersions(args: {
  spaceId: string;
  productId?: ProductSlug;
  session?: ClientSession;
}): Promise<number[]> {
  const versions: number[] = await SpaceProductKey.distinct("keyVersion", {
    spaceId: args.spaceId,
    productId: args.productId ?? "drive",
  }).session(args.session ?? null);
  return versions.sort((left, right) => left - right);
}

/**
 * A new keyholder must receive every issued version, or content encrypted
 * under an older version stays unreadable to them.
 */
export function parseKeyringGrants(value: unknown, versions: number[]): KeyringGrant[] {
  if (!Array.isArray(value)) {
    throw new ProductKeyGrantError(400, "key_grants_required", "Wrapped key grants are required");
  }
  const grants = value.map((grant: { keyVersion?: unknown; wrappedKey?: unknown } | null) => ({
    keyVersion: Number(grant?.keyVersion),
    wrappedKey: typeof grant?.wrappedKey === "string" ? grant.wrappedKey.trim() : "",
  }));
  if (grants.some((grant) => !grant.wrappedKey || !Number.isInteger(grant.keyVersion) || grant.keyVersion < 1)) {
    throw new ProductKeyGrantError(400, "invalid_key_grant", "Each grant needs a keyVersion and wrappedKey");
  }
  const granted = [...new Set(grants.map((grant) => grant.keyVersion))].sort((left, right) => left - right);
  if (
    granted.length !== grants.length ||
    granted.length !== versions.length ||
    granted.some((version, index) => version !== versions[index])
  ) {
    throw new ProductKeyGrantError(
      409,
      "key_grants_incomplete",
      "Grants must cover every key version of this space exactly once",
    );
  }
  return grants;
}

/** Store a complete keyring for one member (see `parseKeyringGrants`). */
export async function putMemberKeyring(
  args: Omit<PutMemberProductKeyInput, "wrappedKey" | "keyVersion"> & { grants: KeyringGrant[] },
): Promise<void> {
  const { grants, ...grant } = args;
  for (const { keyVersion, wrappedKey } of grants) {
    await putMemberProductKey({ ...grant, keyVersion, wrappedKey });
  }
}

/** Move every grant of one member in one Space between statuses. */
export async function setMemberKeyringStatus(args: {
  spaceId: string;
  memberAccountId: string;
  from: MemberKeyStatus[];
  status: MemberKeyStatus;
  productId?: ProductSlug;
  rotationReason?: KeyRotationReason;
  session?: ClientSession;
}): Promise<number> {
  const result = await SpaceProductKey.updateMany(
    {
      spaceId: args.spaceId,
      productId: args.productId ?? "drive",
      memberAccountId: args.memberAccountId,
      status: { $in: args.from },
    },
    {
      $set: {
        status: args.status,
        ...(args.rotationReason ? { rotationReason: args.rotationReason } : {}),
      },
    },
    args.session ? { session: args.session } : undefined,
  );
  return result.modifiedCount;
}

/** A member's keyring: every active version, newest first. */
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

export async function deleteSpaceProductKeys(args: {
  spaceId: string;
  session?: ClientSession;
}) {
  return SpaceProductKey.deleteMany(
    { spaceId: args.spaceId },
    args.session ? { session: args.session } : undefined,
  );
}
