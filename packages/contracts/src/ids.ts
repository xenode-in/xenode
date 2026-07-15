import { z } from "zod";

declare const brand: unique symbol;

export type Brand<T, Name extends string> = T & {
  readonly [brand]: Name;
};

export type AccountId = Brand<string, "AccountId">;
export type SpaceId = Brand<string, "SpaceId">;
export type ProductId = Brand<string, "ProductId">;
export type OrganizationId = Brand<string, "OrganizationId">;
export type TeamId = Brand<string, "TeamId">;
export type ObjectId = Brand<string, "ObjectId">;
export type KeyId = Brand<string, "KeyId">;

const nonEmptyId = z.string().trim().min(1).max(256);

export const accountIdSchema = nonEmptyId.transform((value) => value as AccountId);
export const spaceIdSchema = nonEmptyId.transform((value) => value as SpaceId);
export const productIdSchema = nonEmptyId.transform((value) => value as ProductId);
export const organizationIdSchema = nonEmptyId.transform(
  (value) => value as OrganizationId,
);
export const teamIdSchema = nonEmptyId.transform((value) => value as TeamId);
export const objectIdSchema = nonEmptyId.transform((value) => value as ObjectId);
export const keyIdSchema = nonEmptyId.transform((value) => value as KeyId);
