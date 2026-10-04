# Accounts sensitive-action contract

This contract completes F04 alongside [28-second-factor-contract.md](28-second-factor-contract.md).
Every custom Accounts route calls `authorizeAccountsApiRequest(request, policy)`,
which checks the exact origin for mutations, resolves the session, enforces the
second factor, and then applies the route's policy.

## Recent authentication

A credential or key-material change requires a session created within the last
ten minutes (`recent_auth_required`, 403, otherwise):

| Route | Action |
| --- | --- |
| `POST /api/vault/bootstrap`, `PUT /api/vault/separate-password` | Create the Vault or rewrap its password envelope |
| `POST /api/vault/devices` | Enroll a trusted browser device wrap |
| `POST /api/vault/passkeys/register/*`, `DELETE /api/vault/passkeys` | Add or remove a Vault unlock passkey |
| `POST`/`DELETE /api/account/passkeys` | Bind or remove a sign-in passkey |
| `POST /api/account/password` | Attach a sign-in password (or verify an existing one) |
| Native `passkey/generate-register-options`, `verify-registration`, `delete-passkey`, `link-social`, `unlink-account` | Add or remove a sign-in credential |

Protective actions — revoking devices, product sessions, trusted browsers, or
signing out everywhere — never require recent authentication and are never
rate limited, so a stale or stolen session can always be cut off and an
attacker cannot exhaust the owner's ability to revoke. Changing the sign-in
password requires the current password instead.

## Rate limits

Custom endpoints spend a per-account fixed-window budget stored in
`rateLimitWindows` (`@xenode/database` `consumeRateLimit`, one atomic upsert per
request; a TTL index only reclaims expired windows). Exhaustion returns 429 with
`Retry-After`. Unauthenticated and pending-second-factor requests are rejected
before they spend a budget.

| Budget | Limit | Routes |
| --- | --- | --- |
| `accounts:password` | 5 / 15 min | Attach/verify and change sign-in password |
| `accounts:vault-write` | 10 / 10 min | Vault bootstrap, password rewrap, device and passkey writes |
| `accounts:vault-unlock` | 30 / 10 min | Unlock confirmation and passkey unlock ceremonies |
| `accounts:credentials` | 10 / 10 min | Sign-in passkey binding and removal |
| `accounts:key-handoff` | 60 / 10 min | Product key handoff creation |
| `accounts:profile` | 30 / 10 min | Profile and onboarding updates |

Better Auth's own router limiter (production) now uses database storage shared
by all instances, a unique `rateLimit.key` index for its insert-race detection,
and a 10-per-minute rule for `/two-factor/*` in addition to its built-in rules
for sign-in, sign-up, password change and reset/OTP sends. It keys on the
client IP from `X-Forwarded-For`; deployments with more than one proxy hop must
set `AUTH_TRUSTED_PROXIES`, otherwise Better Auth falls back to one shared
bucket per path. Server-to-server `/oauth2/token` stays on the default rule.

## Session revocation

- Changing the sign-in password with `revokeOtherSessions` deletes every
  Better Auth session and issues this browser a new one. All product sessions
  for the account are revoked (the delete hook sees at most 100 sessions, so
  the route revokes account-wide), and trusted browsers are revoked. The
  replacement session inherits the second-factor verification of the session
  that authorized the change.
- `revokeSessionsOnPasswordReset` is enabled for when password reset is offered.
- RP-initiated logout (`/oauth2/end-session`) fails closed in Better Auth 1.7
  when the session cannot be deleted; the session delete hook revokes the
  issuer's product sessions first.

The unused `POST /api/vault/password-envelope` route was removed.

## Evidence

`tests/sensitive-actions.test.ts` covers window/limit behavior, concurrency,
malformed rules, the recent-auth predicate, per-account budgets, the password
verification oracle (five checks, then 429), stale sessions keeping protective
revocation, native credential endpoints and pending-session passkey sign-in.
`tests/oidc-second-factor-gate.test.ts` changes a real two-factor account's
password through the production Better Auth configuration and verifies session
rotation, inherited verification and account-wide product revocation; a
negative-control run without inheritance fails. Browser journeys remain release
gates.
