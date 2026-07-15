import type { ProductSlug } from "@xenode/contracts";
import { SpaceProductKey } from "@xenode/database/models";
import {
  putMemberProductKey,
  setMemberProductKeyStatus,
  type KeyRotationReason,
  type MemberKeyStatus,
} from "@xenode/spaces/product-keys";

export { SpaceProductKey };

export async function createTestProductKey(args: {
  spaceId: string;
  memberAccountId: string;
  wrappedKey: string;
  keyVersion?: number;
  productId?: ProductSlug;
  status?: MemberKeyStatus;
  rotationReason?: KeyRotationReason;
  createdByAccountId?: string;
}) {
  const keyVersion = args.keyVersion ?? 1;
  const status = args.status ?? "active";
  const key = await putMemberProductKey({
    spaceId: args.spaceId,
    productId: args.productId ?? "drive",
    memberAccountId: args.memberAccountId,
    wrappedKey: args.wrappedKey,
    keyVersion,
    createdByAccountId: args.createdByAccountId ?? "owner_1",
    rotationReason: args.rotationReason ?? "initial",
    status: status === "pending" ? "pending" : "active",
  });
  if (status !== "pending" && status !== "active") {
    return setMemberProductKeyStatus({
      spaceId: args.spaceId,
      productId: args.productId ?? "drive",
      memberAccountId: args.memberAccountId,
      keyVersion,
      status,
      rotationReason: args.rotationReason ?? "initial",
    });
  }
  return key;
}

export function activeKeyQuery(spaceId: string) {
  return { spaceId, productId: "drive", status: "active" as const };
}