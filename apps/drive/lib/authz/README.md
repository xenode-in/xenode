# Drive authorization

`lib/authz` centralizes actor resolution and Space access.

- `context.ts` resolves the Drive ProductSession and requested personal,
  organization, or team Space into an `AccessContext`.
- `policy.ts` builds Space-scoped object/bucket clauses and provides
  load-or-throw helpers for read, write, delete, share, and manage actions.
- `errors.ts` provides `AuthzError`, `isAuthzError`, and `toJsonResponse`.

New routes must call `requireAccessContext(request)` and apply an authorization
helper before querying or mutating a resource. Never authorize by product ID,
client-provided owner fields, bucket ownership, or an active-organization UI
preference. Product ID identifies the caller; `spaceId` is the data boundary.
