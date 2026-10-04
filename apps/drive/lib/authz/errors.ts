import { NextResponse } from "next/server";

/**
 * Authorization-layer error.
 *
 * Thrown by the access-context / policy helpers in `lib/authz` when the caller
 * is missing, or is not allowed to touch the requested resource. Routes convert
 * it to an HTTP response with `toJsonResponse()` (or via `isAuthzError`).
 *
 * Mirrors the lightweight `BillingError` pattern in `lib/billing/http.ts` so the
 * two error families feel consistent across the API surface.
 */
export class AuthzError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AuthzError";
    this.status = status;
    this.code = code;
  }
}

/** `@xenode/spaces` grant refusals carry the same status/code/message shape. */
const AUTHZ_ERROR_NAMES = new Set(["AuthzError", "ProductKeyGrantError"]);

export function isAuthzError(err: unknown): err is AuthzError {
  return err instanceof AuthzError || AUTHZ_ERROR_NAMES.has((err as { name?: string })?.name ?? "");
}

/** Convert a thrown AuthzError into a JSON NextResponse. */
export function toJsonResponse(err: AuthzError): NextResponse {
  return NextResponse.json(
    { error: err.message, code: err.code },
    { status: err.status },
  );
}

/** Standard 401 — kept message-compatible with the legacy `requireAuth` flow. */
export const UNAUTHORIZED = () =>
  new AuthzError(401, "unauthorized", "Unauthorized");
