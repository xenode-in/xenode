/**
 * Post-auth redirect cookie — lets a page (e.g. an org invite link) send an
 * unauthenticated visitor through signup → email verify → onboarding and land
 * them back where they started. Client-only (reads/writes `document.cookie`).
 */
const COOKIE = "xenode_post_auth_redirect";
const MAX_AGE_SECONDS = 30 * 60;

/** Persist an internal return path (ignored if not app-internal). */
export function setPostAuthRedirect(path: string): void {
  if (typeof document === "undefined" || !path.startsWith("/")) return;
  document.cookie = `${COOKIE}=${encodeURIComponent(
    path,
  )}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
}

/**
 * Read and clear the return path. Returns null if unset or not an internal
 * path (guards against open-redirects).
 */
export function consumePostAuthRedirect(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${COOKIE}=([^;]*)`),
  );
  if (!match) return null;
  document.cookie = `${COOKIE}=; path=/; max-age=0; samesite=lax`;
  const value = decodeURIComponent(match[1]);
  return value.startsWith("/") && !value.startsWith("//") ? value : null;
}
