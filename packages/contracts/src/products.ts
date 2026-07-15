import { z } from "zod";

export const productSlugs = [
  "accounts",
  "drive",
  "photos",
  "mobile",
  "office-editor",
] as const;

export const productSlugSchema = z.enum(productSlugs);
export type ProductSlug = z.infer<typeof productSlugSchema>;

export const spaceTypes = ["personal", "organization", "team"] as const;
export const spaceTypeSchema = z.enum(spaceTypes);
export type SpaceType = z.infer<typeof spaceTypeSchema>;

export const spaceRoles = ["owner", "admin", "member", "guest"] as const;
export const spaceRoleSchema = z.enum(spaceRoles);
export type SpaceRole = z.infer<typeof spaceRoleSchema>;

export interface ProductRegistration {
  id: ProductSlug;
  origin: URL;
  displayName: string;
}
