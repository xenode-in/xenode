/**
 * Set by the proxy on every page request (overwriting any client value): the
 * path a sign-in started from that request should return to.
 */
export const RETURN_PATH_HEADER = "x-xenode-return-path";

/** The sign-in route; it validates `next` before using it. */
export function loginPath(returnPath: string | null | undefined): string {
  return returnPath ? `/auth/login?${new URLSearchParams({ next: returnPath })}` : "/auth/login";
}
