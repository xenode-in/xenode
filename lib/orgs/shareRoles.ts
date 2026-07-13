/**
 * Direct-share permission roles (Viewer / Commenter / Editor).
 *
 * Historically `DirectShare.recipients[].accessType` was only `"view" | "download"`.
 * Those legacy values map to the read tier (`viewer`). Keep this the single source
 * of truth for role semantics so the API, UI, and enforcement stay in sync.
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

/**
 * Coerce any stored/incoming accessType (including legacy `view`/`download`) to a
 * canonical ShareRole. Unknown values fall back to the least-privileged `viewer`.
 */
export function normalizeShareRole(value: unknown): ShareRole {
  if (value === "commenter") return "commenter";
  if (value === "editor") return "editor";
  // legacy: "view", "download", anything else → viewer
  return "viewer";
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
