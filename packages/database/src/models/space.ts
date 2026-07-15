import { Schema } from "mongoose";
import type { ProductSlug, SpaceRole, SpaceType } from "@xenode/contracts";
import { getModel } from "../model";

export interface SpaceRecord {
  _id: string;
  type: SpaceType;
  ownerAccountId?: string;
  organizationId?: string;
  teamId?: string;
  status: "active" | "suspended" | "deleted";
  createdByAccountId: string;
  createdAt: Date;
  updatedAt: Date;
}

const spaceSchema = new Schema<SpaceRecord>(
  {
    _id: { type: String, required: true },
    type: {
      type: String,
      enum: ["personal", "organization", "team"],
      required: true,
      index: true,
    },
    ownerAccountId: { type: String, index: true },
    organizationId: { type: String, index: true },
    teamId: { type: String, index: true },
    status: {
      type: String,
      enum: ["active", "suspended", "deleted"],
      default: "active",
      required: true,
      index: true,
    },
    createdByAccountId: { type: String, required: true },
  },
  { timestamps: true, collection: "spaces" },
);

spaceSchema.index(
  { ownerAccountId: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { type: "personal" },
    name: "one_personal_space_per_account",
  },
);
spaceSchema.index(
  { organizationId: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { type: "organization" },
    name: "one_space_per_organization",
  },
);
spaceSchema.index(
  { organizationId: 1, teamId: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { type: "team" },
    name: "one_space_per_team",
  },
);

export const Space = getModel<SpaceRecord>("Space", spaceSchema);

export interface SpaceProductKeyRecord {
  _id: string;
  spaceId: string;
  productId: ProductSlug;
  keyVersion: number;
  memberAccountId: string;
  algorithm: "AES-256-GCM";
  ciphertext: string;
  iv: string;
  aadVersion: number;
  status: "active" | "retired" | "revoked";
  createdByAccountId: string;
  createdAt: Date;
  updatedAt: Date;
}

const spaceProductKeySchema = new Schema<SpaceProductKeyRecord>(
  {
    _id: { type: String, required: true },
    spaceId: { type: String, ref: "Space", required: true, index: true },
    productId: {
      type: String,
      enum: ["accounts", "drive", "photos", "mobile", "office-editor"],
      required: true,
      index: true,
    },
    keyVersion: { type: Number, required: true, min: 1 },
    memberAccountId: { type: String, required: true, index: true },
    algorithm: { type: String, enum: ["AES-256-GCM"], required: true },
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    aadVersion: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ["active", "retired", "revoked"],
      default: "active",
      required: true,
      index: true,
    },
    createdByAccountId: { type: String, required: true },
  },
  { timestamps: true, collection: "spaceProductKeys" },
);

spaceProductKeySchema.index(
  { spaceId: 1, productId: 1, memberAccountId: 1, keyVersion: 1 },
  { unique: true },
);
spaceProductKeySchema.index({ spaceId: 1, productId: 1, status: 1 });

export const SpaceProductKey = getModel<SpaceProductKeyRecord>(
  "SpaceProductKey",
  spaceProductKeySchema,
);

export type ResolvedSpaceRole = SpaceRole;
