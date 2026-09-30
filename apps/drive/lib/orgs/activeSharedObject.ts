import { Space } from "@xenode/database/models";
import StorageObject from "@/models/StorageObject";
import type { Types } from "mongoose";

/** Direct-share recipients must not bypass a suspended or retiring Space. */
export async function hasActiveSharedObject(objectId: Types.ObjectId) {
  return areActiveSharedObjects([objectId]);
}

export async function areActiveSharedObjects(objectIds: Types.ObjectId[]) {
  const ids = [...new Map(objectIds.map((id) => [String(id), id])).values()];
  if (!ids.length) return false;
  const objects = await StorageObject.find({ _id: { $in: ids }, deletedAt: null, purgeState: { $exists: false } })
    .select("spaceId").lean();
  if (objects.length !== ids.length) return false;
  const spaceIds = [...new Set(objects.map((object) => object.spaceId))];
  return await Space.countDocuments({ _id: { $in: spaceIds }, status: "active" }) === spaceIds.length;
}
