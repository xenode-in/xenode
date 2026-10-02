# Accounts second-factor contract

This contract closes F32–F34. It applies to every session Better Auth creates
in Accounts and to every path that can issue an OIDC authorization code.

## Session state

`session.twoFactorVerifiedAt` is the only signal that a session satisfied the
account's second factor. When Better Auth creates a session, Accounts sets it
only if the creating path completed a factor (`/passkey/*`, `/two-factor/*`)
or the account has two-factor disabled. Every other path — password, social
callback, email-OTP auto sign-in, or an unrecognized path — starts **pending**
for a two-factor account. `authMethod` records how the session was created or
verified (`password`, `oauth`, `email-otp`, `passkey`, `totp`,
`trusted-device`) and is informational only.

A credential sign-in survives Better Auth's two-factor plugin only when the
plugin accepts and rotates its signed trusted-device cookie. A trailing plugin,
registered after `twoFactor`, marks exactly that session `trusted-device`
verified. Xenode's own trusted-browser token (`xenode_accounts_2fa_trusted`)
can likewise upgrade a pending session; the step-up route creates it after
either a sign-in challenge or a session step-up when the user opts in.

## Verification and lockout

`POST /api/account/two-factor/verify` accepts `{ code, method, trustDevice }`
from the exact Accounts origin. TOTP codes are six digits; backup codes are
`XXXXX-XXXXX`. Malformed input returns 400 before any verification.

- **No session (sign-in challenge):** delegated to Better Auth, which enforces
  its per-challenge attempts and the account lockout.
- **Pending session (step-up):** one attempt is reserved atomically from the
  account's consecutive-failure budget on Better Auth's own `twoFactor` row
  (`failedVerificationCount`, `lockedUntil`) before the code is checked. Ten
  failures lock the account for fifteen minutes (429 with `Retry-After`); a
  locked account checks no codes, even correct ones. Success resets the
  budget and marks the session verified. Parallel guesses cannot exceed the
  budget. An account without a verified enrollment returns 409.
- **Verified session:** returns success without checking a code.

The native `/two-factor/verify-*` and `/two-factor/send-otp` endpoints remain
available to sign-in challenges and verified sessions (enrollment). A pending
session receives 403: Better Auth's session mode has no attempt budget.

## Authorization codes

The OAuth provider's `postLogin.shouldRedirect` gate runs for every authorize
invocation, including the in-process authorization the provider performs after
a sign-in or social callback carrying `oauth_query`. It returns true while the
session needs its second factor, onboarding or the Vault unlock confirmation,
and the provider then redirects to `/auth/post-login` instead of issuing a
code. That route only rebuilds the allowlisted authorize parameters and
redirects to the same-origin `/api/auth/oauth2/authorize`, whose wrapper sends
the user to the specific step-up page with `next`. Both paths use one function,
`authorizationInteraction`.

## Native endpoints for pending sessions

Pending sessions may sign in, sign up, sign out, exchange tokens and complete
email verification. Native POST mutations from a pending session require the
exact origin and are denied. Native GETs are denied except `get-session`,
`ok`, `error`, `jwks`, `verify-email`, OIDC end-session/userinfo,
`/callback/*`, `/reset-password/*` and `/.well-known/*`; account listings such
as `list-sessions` and `list-accounts` return 403.

## Evidence

`tests/oidc-second-factor-gate.test.ts` drives the production Better Auth
configuration with real TOTP codes. Before this contract, a navigation-mode
password sign-in carrying a signed `oauth_query` for a two-factor account
leaked an authorization code in the `Location` header while the response body
asked for the second factor; a pending session's in-process authorize issued
a code. Both cases now defer to the gate, verified by a negative-control run
with the gate removed. `tests/auth-security-records.test.ts` covers the
lockout, parallel guesses, reset, expired locks and sign-in delegation.
Browser journeys with real providers and authenticators remain release gates.
