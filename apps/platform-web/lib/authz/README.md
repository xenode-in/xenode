# `lib/authz` — centralized authorization (org-ready)

This is the **single home** for "who is acting" and "may they touch this resource".
It exists so that introducing Organizations & Team Workspaces later is a localized
change rather than a sweep across ~100 routes.

## The pieces

- **`context.ts`** — `getAccessContext(request)` / `requireAccessContext(request)`
  resolve a better-auth session into an `AccessContext { userId, scope, session }`.
  `scope` is `personal` today; it becomes `organization` (active org + member role)
  once the better-auth `organization` plugin is enabled — and that is the **only**
  place that changes to flip orgs on.
- **`policy.ts`** — the **ownership seam**. `objectFilter`/`bucketFilter` (and the
  `*OwnershipClause` variants) return the Mongoose filter scoping a query to what
  the caller may access. `assertObjectAccess`/`assertBucketAccess` load-or-throw
  `AuthzError(404)`. An `Action` union (`read|write|delete|share|manage`) is
  carried through for forward-compat; under personal scope ownership implies all
  actions, so it isn't branched on yet.
- **`errors.ts`** — `AuthzError(status, code, message)` + `isAuthzError` +
  `toJsonResponse`. The 401 error's `message` is `"Unauthorized"` so legacy catch
  blocks (`error.message === "Unauthorized"`) keep mapping it to 401.

## How to use it in a route

New routes (cleanest):

```ts
import { requireAccessContext, assertObjectAccess, isAuthzError, toJsonResponse } from "@/lib/authz";

const ctx = await requireAccessContext(request);
const object = await assertObjectAccess(ctx, id, "write");
// ...
catch (e) { if (isAuthzError(e)) return toJsonResponse(e); /* ... */ }
```

Existing routes (minimal, behavior-preserving) — keep your query ergonomics, just
swap the ownership literal for the builder:

```ts
const ctx = await requireAccessContext(request);
const object = await StorageObject.findOne(objectFilter(ctx, id)).lean();
const bucket = await Bucket.findOne({ _id: object.bucketId, ...bucketOwnershipClause(ctx) });
```

## When Organizations arrive

1. Enable the better-auth `organization` plugin in `lib/auth/index.ts`.
2. Populate `organization` scope in `getAccessContext`.
3. Add the `orgId` owner field to `Bucket`/`StorageObject` and extend the two
   `*OwnershipClause` functions to `$or` on it (+ branch `Action` on role).

Every route that adopted these helpers becomes org-aware with no further edits.
New routes should adopt this pattern; the remaining legacy routes can be migrated
incrementally.
