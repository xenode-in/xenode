import { Types } from "mongoose";

import PhotoAlbum from "@/models/PhotoAlbum";

/**
 * Turn an album name into a URL-safe slug: lowercase, spaces/punctuation
 * collapsed to single hyphens, diacritics stripped. Falls back to "album"
 * when the name has no slug-able characters (e.g. emoji-only names).
 */
export function slugify(value: string): string {
  const base = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return base || "album";
}

/**
 * Generate a slug unique within a user's albums by appending `-2`, `-3`, …
 * until no existing album collides.
 */
export async function generateUniqueAlbumSlug(
  userId: string,
  name: string,
): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  // Bounded loop — append an incrementing suffix until the slug is free.
  // eslint-disable-next-line no-await-in-loop
  while (await PhotoAlbum.exists({ userId, slug: candidate })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/**
 * Build a Mongo filter that matches an album by either its ObjectId or its
 * slug, scoped to the owner. Lets API routes accept slug-or-id transparently.
 */
export function albumIdentifierFilter(userId: string, identifier: string) {
  const or: Array<Record<string, unknown>> = [{ slug: identifier }];
  if (Types.ObjectId.isValid(identifier)) {
    or.push({ _id: new Types.ObjectId(identifier) });
  }
  return { userId, $or: or };
}
