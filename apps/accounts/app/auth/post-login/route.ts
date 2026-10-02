import { resumeAuthorizationPath } from "@/lib/presentation";

/**
 * The OAuth provider sends in-process authorizations here when the session
 * still needs a second factor, onboarding or Vault unlock. Resume through the
 * authorize GET so its wrapper chooses the step-up page; never redirect to a
 * caller-chosen destination.
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  return Response.redirect(
    new URL(resumeAuthorizationPath(url.searchParams), url.origin),
    303,
  );
}
