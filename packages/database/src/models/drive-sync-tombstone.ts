import { Schema, type Types } from "mongoose";
import { getModel } from "../model";

export interface DriveSyncTombstoneRecord {
  _id: Types.ObjectId;
  spaceId: string;
  syncVersion: number;
  deletedAt: Date;
}
const schema = new Schema<DriveSyncTombstoneRecord>({
  _id: { type: Schema.Types.ObjectId, required: true },
  spaceId: { type: String, required: true },
  syncVersion: { type: Number, required: true, min: 1 },
  deletedAt: { type: Date, required: true },
}, { collection: "driveSyncTombstones", versionKey: false });
schema.index({ spaceId: 1, syncVersion: 1, _id: 1 });
// No TTL: offline clients must observe removals after long absence.
export const DriveSyncTombstone = getModel<DriveSyncTombstoneRecord>("DriveSyncTombstone", schema);
