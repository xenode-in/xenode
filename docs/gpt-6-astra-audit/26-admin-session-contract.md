# Current Admin authority and JWT revocation

Admin identities remain separate from Accounts users and ProductSessions. Their
model is owned by `@xenode/database`, in the `admins` collection. Drive owns the
operator credential check, cookie and request guards.

## Session contract

Successful credential login checks the bcrypt hash of an active Admin, then
re-reads the same Admin security version before issuing a token. A security
change between credential verification and issuance prevents cookie creation.

The host-only HttpOnly cookie is `Xenode_admin_session` in development and
`__Host-Xenode_admin_session` in production (Secure, Path=/, SameSite=Lax). Its JWT
uses HS256, type JWT, issuer `xenode-drive-admin`, exact audience `xenode-admin`,
issued-at and expiry with a maximum eight-hour lifetime. The claims bind the
Admin ID, role and integer `sessionVersion`. `ADMIN_JWT_SECRET` must be explicitly
configured with at least 32 characters; there is no development fallback.

Both cookie and request readers verify those claims and read the current Admin
from the primary database. It must still exist, be active, and have the same role
and security version. Guards return database identity fields, never trust the
JWT username as current authority, and fail closed on database errors. Tokens
without the new issuer/audience/version are rejected; there is no legacy bypass.

## Security changes

`PATCH /api/admin/admins/{adminId}` requires a current super-admin. A role or
active-state update atomically increments `sessionVersion`, including repeated
or concurrent changes. Existing tokens stop authenticating on the next request.
Disable/re-enable does not restore old tokens. Deletion makes all tokens for that
Admin invalid because the authoritative record no longer exists. Self-demotion
or self-disable also invalidates the current token; a deleted self is refused by
the existing DELETE policy.

Password/security changes implemented in future must also increment the version
atomically. This version revokes all tokens for the Admin; cookie logout itself
continues to clear only the local cookie. Already admitted requests/side effects
are not rolled back by a later security change.

The password hash is excluded from ordinary database projections. The login
route selects it explicitly for bcrypt comparison. Admin mutation responses
never return it. Accounts user collections and crypto material are not read by
Admin session validation.

## Development reset and validation

Fresh Admin records receive version 1. Reset disposable development state and
reseed via `ADMIN_USERNAME`/`ADMIN_PASSWORD` when using the new contract; do not
backfill versions to preserve old JWTs. Existing seed accounts, including
disabled/demoted ones, are left unchanged. Seed configuration cannot restore
their privileges. `npm run dev:mongo` provides the shared ephemeral replica set.
No existing database reset is performed by this phase.

Disposable Mongo tests use real signed JWTs and the actual session readers and
Admin mutation/login routes. They cover current identity, disable/delete/demote,
version revocation, re-enable, concurrent security updates, stale credential
issuance, wrong issuer/audience/algorithm/type, malformed/missing claims, expiry,
database failure, explicit secrets and seed non-resurrection. Live browser and
deployed Admin-host validation remain release gates.
