/**
 * Direct-share permission roles (Viewer / Commenter / Editor).
 *
 * Unknown or legacy values fail closed. Keep this the single source of truth
 * for API, UI, and enforcement semantics.
 *
 * Capability nesting (each tier includes the ones before it):
 *   viewer    → preview + download
 *   commenter → + read/write comments
 *   editor    → + rename & edit content (versioned)
 */
export const SHARE_ROLES = ["viewer", "commenter", "editor"] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];

const RANK: Record<ShareRole, number> = {
  viewer: 0,
  commenter: 1,
  editor: 2,
};

/** Parse a canonical ShareRole, rejecting unknown or legacy values. */
export function normalizeShareRole(value: unknown): ShareRole {
  if (value === "viewer" || value === "commenter" || value === "editor") {
    return value;
  }
  throw new Error("Invalid share role");
}

/** True if `role` is at least `required` in the capability hierarchy. */
export function roleAtLeast(role: ShareRole, required: ShareRole): boolean {
  return RANK[role] >= RANK[required];
}

export function canDownload(role: ShareRole): boolean {
  return roleAtLeast(role, "viewer");
}
export function canComment(role: ShareRole): boolean {
  return roleAtLeast(role, "commenter");
}
export function canEdit(role: ShareRole): boolean {
  return roleAtLeast(role, "editor");
}
