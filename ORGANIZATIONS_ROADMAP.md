# Organizations & Team Workspaces — Build Reference (SUPERSEDED)

> **⚠️ STALE — DO NOT USE AS SOURCE OF TRUTH.** Organizations are **already
> implemented** at HEAD (org/member/invitation/team plugin wired, ~45
> `app/api/orgs/**` routes, `OrgKeyGrant`/`OrgUsage`/`OrgDomain` models,
> key-grant rotation on member removal, domain verification). This document
> predates that work and describes it as future. The authoritative forward plan
> is now the **Modular Monorepo Migration plan** (Space model in PR4, role-set
> normalization + `manager` removal + `SpaceProductKey` in PR13). The remaining
> genuine gap it flagged — server-side share `accessType` enforcement — is
> tracked in that plan (F-SHAREROLE, PR13). Kept for historical context only.
>
> **Original (stale) preface below.**
>
> **This was the go-to reference for building Organizations.** It inventories what
> already exists and can be reused, what must be built, and the exact design
> decisions (especially E2EE for shared spaces) that the build depends on.
>
> **Goal:** Launch Xenode for SMBs — organizations, team workspaces, roles, shared
> drives, team billing/seats, shared quotas, activity logs, and an org admin
> dashboard — **without breaking the E2EE guarantee** (the server never sees
> plaintext keys or file bytes).

---

## 0. Foundations already in place (Phase 1)

We deliberately built the authorization + versioning groundwork to be org-ready.
Organizations plug into these seams:

| Foundation | File(s) | Why it matters for Orgs |
|---|---|---|
| **Access context** | [lib/authz/context.ts](lib/authz/context.ts) | `AccessScope` already has an `organization` variant. Turning orgs on is *one function* (`getAccessContext`) populating it from the session's active org + role. |
| **Ownership policy seam** | [lib/authz/policy.ts](lib/authz/policy.ts) | `objectOwnershipClause`/`bucketOwnershipClause`/`ownerClause` + the `Action` union (`read\|write\|delete\|share\|manage`). Every adopting route becomes org-aware when these clauses learn about `orgId`. |
| **Defense-in-depth gate** | [proxy.ts](proxy.ts) | Already routes admin/docs subdomains and gates private routes; org subdomains/paths extend the same file. |
| **Actor vs owner on versions** | [models/StorageObject.ts](models/StorageObject.ts) (`versions[].createdBy`) | Already records *who* edited, distinct from the owner — required for team-shared files. |
| **authz README** | [lib/authz/README.md](lib/authz/README.md) | Documents the exact 3-step switch-on procedure for orgs. |

**The org switch-on procedure (already documented):**
1. Enable better-auth `organization` plugin in [lib/auth/index.ts](lib/auth/index.ts).
2. Populate `organization` scope in `getAccessContext`.
3. Add `orgId`/`teamId` owner fields to `Bucket`/`StorageObject` and extend the
   `*OwnershipClause` functions to `$or` on them (+ branch `Action` on role).

---

## 1. Guiding constraints (do not violate)

1. **E2EE holds.** Server stores ciphertext + wrapped keys only. Org/team sharing
   must distribute keys client-side (wrap to member public keys), never plaintext.
2. **Security boundaries** ([BILLING_SECURITY.md](BILLING_SECURITY.md)) extend to
   orgs: team-billing code may read org `Usage`/`Subscription` only — never keys,
   never `StorageObject` crypto fields.
3. **`syncUserSubscriptionState` discipline** ([lib/subscriptions/service.ts](lib/subscriptions/service.ts)):
   one place mutates plan/limit. Orgs get an `syncOrgSubscriptionState` analogue —
   do not scatter quota writes.
4. **Additive, not destructive.** Personal drives keep working unchanged; org is a
   new scope layered on top. No data migration of existing personal files.

---

## 2. Build on better-auth's `organization` plugin (decided)

We align with better-auth's first-class plugin rather than a custom model.

| Capability | Provided by plugin | Notes / verify against installed `better-auth@1.5.5` |
|---|---|---|
| `organization`, `member`, `invitation` collections | ✅ built-in | Created via the mongodb adapter (same connection as everything else). |
| Create / join / switch org | ✅ `createOrganization`, `setActiveOrganization`, accept invitation | `activeOrganizationId` lands in the session — read it in `getAccessContext`. |
| Invite members (email) | ✅ `inviteMember` + invitation lifecycle | Hook the email through [lib/email/notifications.ts](lib/email/notifications.ts) + a new template in [lib/email/templates.ts](lib/email/templates.ts). |
| Roles + permissions | ✅ `createAccessControl` (statements → roles) | Built-in `owner/admin/member`; **add `manager` and `guest` as custom roles** mapped to our `Action` union. |
| **Teams within an org** | ✅ optional `teams: { enabled: true }` | This is our **Team Drive / Team Workspace** primitive — use it instead of inventing a Team model. |
| Client hooks | ✅ `organizationClient()` | Wire into the existing better-auth client ([lib/auth/client.ts](lib/auth/client.ts)). |

**Action:** add `organization({ teams: { enabled: true }, ac, roles })` to the
`plugins` array in [lib/auth/index.ts](lib/auth/index.ts) and `organizationClient()`
to the client. Keep the `user` collection singular (better-auth requirement,
already the case).

---

## 3. Roles & permission matrix

Map the five product roles onto better-auth access-control roles, expressed in our
existing `Action` union so the policy layer enforces them centrally.

| Action → / Role ↓ | read | write | delete | share | manage (members/settings) | billing |
|---|---|---|---|---|---|---|
| **Owner** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Admin** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Manager** | ✅ | ✅ | ✅ (team scope) | ✅ | team members only | ❌ |
| **Member** | ✅ | ✅ | own/team per policy | ✅ | ❌ | ❌ |
| **Guest** | ✅ (explicitly shared only) | ❌ | ❌ | ❌ | ❌ | ❌ |

- Define statements with `createAccessControl` (e.g. `file`, `member`, `team`,
  `billing`, `org`). Owner/Admin/Manager/Member/Guest are role bundles over them.
- **Enforcement point:** `assertObjectAccess`/`assertBucketAccess` in
  [lib/authz/policy.ts](lib/authz/policy.ts) start branching on `ctx.scope` +
  `action`. This is the single change that makes every adopted route role-aware.

---

## 4. Shared spaces model (Personal / Org / Team Drive)

Introduce an explicit owner-scope on storage so the three drives coexist:

```
StorageObject / Bucket  (add):
  ownerScope: "personal" | "organization" | "team"   // default "personal"
  orgId?:  string        // set for organization + team scope
  teamId?: string        // set for team scope only
```

- **Personal Drive** — unchanged. `ownerScope:"personal"`, scoped by `userId`
  (today's `ownerClause`).
- **Organization Drive** — `ownerScope:"organization"`, scoped by `orgId`; visible
  to all org members per role.
- **Team Drive** — `ownerScope:"team"`, scoped by `teamId` (a better-auth team);
  visible to that team's members.

`getAccessContext` resolves the active scope; the `*OwnershipClause` functions
return the right filter:

```
personal:     { userId, ownerScope: "personal" }
organization: { orgId, ownerScope: "organization" }   // + member check
team:         { teamId, ownerScope: "team" }           // + team-member check
```

**Reuse:** Buckets already key by an owner string and carry `b2BucketId`; org/team
drives are new `Bucket` rows with `ownerScope/orgId/teamId` set. The opaque object
key scheme (`users/{id}/{hex}`) generalizes to `orgs/{orgId}/{hex}` —
see `newObjectKey` in [lib/storage/versions.ts](lib/storage/versions.ts).

---

## 5. E2EE for shared spaces — the hard part (design)

Personal files use a per-file DEK wrapped by the user's RSA-4096 public key. Shared
drives need a key **multiple members** can use. **We already have the exact
primitive** in [models/DirectShare.ts](models/DirectShare.ts): a per-share AES key,
wrapped *per recipient* under their RSA public key. Generalize it:

### 5.1 Group-key model
- Each **Organization** and each **Team** has a long-lived symmetric **space key**
  (`OrgKey` / `TeamKey`), generated client-side by the creator.
- Files in that drive: the file DEK is wrapped by the **space key** (not by each
  member's pubkey).
- The **space key itself** is wrapped *per member* under their RSA public key and
  stored in a new `OrgKeyGrant` collection (mirrors `DirectShare.recipients[]`).

### 5.2 Member lifecycle
- **Join / accept invite:** an Owner/Admin (who can unwrap the space key) re-wraps
  it to the new member's public key → new `OrgKeyGrant` row. Reuses the
  `direct-shares/recipients` public-key lookup ([app/api/direct-shares/recipients/route.ts](app/api/direct-shares/recipients/route.ts)).
- **Remove member / role downgrade:** revoke their grant **and rotate the space
  key** (generate a new one, re-wrap to remaining members; new uploads use it).
  This closes the gap the audit flagged ("no key rotation / device revocation").
- **Guest:** no space key. Access only via per-resource grants — reuse `DirectShare`
  (internal) or `ShareLink` (link) exactly as today.

### 5.3 Reuse inventory for crypto
| Need | Reuse |
|---|---|
| Per-recipient key wrapping | [models/DirectShare.ts](models/DirectShare.ts), [app/api/direct-shares/route.ts](app/api/direct-shares/route.ts) |
| Public-key lookup for members | [app/api/direct-shares/recipients/route.ts](app/api/direct-shares/recipients/route.ts) |
| File encryption / DEK wrapping | [lib/crypto/fileEncryption.ts](lib/crypto/fileEncryption.ts) |
| Client key cache / vault unlock | [contexts/CryptoContext.tsx](contexts/CryptoContext.tsx), [lib/crypto/keyCache.ts](lib/crypto/keyCache.ts) |
| Wrapped-key API shape | `encryptedDEK`/`iv` fields already on `StorageObject` + version entries |

### 5.4 Open crypto questions (resolve before building 5.x)
1. **Rotation cost:** rotate-on-leave re-wraps only the *space key* per member
   (cheap), but old files stay under the old space key. Decision: keep old space
   keys retrievable by current members (key history) vs. lazily re-wrap file DEKs.
   Recommend **key history** (store rotated space keys, all wrapped per current
   member) — O(members) per rotation, not O(files).
2. **Who holds rotation authority:** Owner + Admin only (they always have a grant).
3. **Server-side share enforcement** (audit gap): `accessType` view-vs-download must
   be enforced server-side for org shares — fold into `assertObjectAccess`.

---

## 6. Data model summary (new + changed)

**New collections**
- `OrgUsage` (or extend `Usage` with `orgId`) — org-level `totalStorageBytes`,
  `storageLimitBytes`, `seats`, `plan`. Mirror [models/Usage.ts](models/Usage.ts).
- `OrgKeyGrant` — `{ orgId, teamId?, memberUserId, wrappedSpaceKey, keyVersion, createdBy }`.
- `ActivityLog` — `{ orgId, actorUserId, action, target, metadata(PII-stripped), createdAt }`.
  Model directly on [models/BillingEvent.ts](models/BillingEvent.ts) + `emitBillingEvent`.
- (Plugin-managed) `organization`, `member`, `invitation`, `team`.

**Changed**
- `Bucket`, `StorageObject`: add `ownerScope`, `orgId?`, `teamId?` (+ indexes).
- `Subscription`/`Payment`: add optional `orgId` so a subscription can belong to an org.
- `getAccessContext`: populate `organization` scope.

---

## 7. Business features — what to reuse vs build

| Feature | Reuse | Build |
|---|---|---|
| **Team billing** | Entire Razorpay pipeline: [lib/billing/**](lib/billing), webhooks ([lib/billing/webhooks/handlers.ts](lib/billing/webhooks/handlers.ts)), `BillingEvent`, idempotency, `BillingError`/`jsonError`, invoices+PDF ([app/api/billing/invoices/[id]/route.ts](app/api/billing/invoices/%5Bid%5D/route.ts)) | Org-payer subscription (payer = Owner), `orgId` on Subscription, `syncOrgSubscriptionState` analogue of [lib/subscriptions/service.ts](lib/subscriptions/service.ts). |
| **Seat management** | Razorpay subscription **quantity** field; PricingConfig per-cycle rows ([models/PricingConfig.ts](models/PricingConfig.ts)) | Seat count ↔ member count enforcement; block invites past seats; proration on seat change (reuse [lib/billing/proration.ts](lib/billing/proration.ts)). |
| **Team storage quotas** | Metering engine + quota enforcement: `incrementStorage`/`adjustStorageBytes`/`recalculateUsage` in [lib/metering/usage.ts](lib/metering/usage.ts) (already enforces ceilings atomically) | Scope these by `orgId` (org Usage doc); enforce at presign for org/team drives. |
| **Shared folders** | Folder model (prefix-based virtual folders), `move`, sync events ([lib/realtime/publish.ts](lib/realtime/publish.ts)) | Folder-level grants for Team/Guest (per-folder space-key or DirectShare). |
| **Activity logs** | `emitBillingEvent` fire-and-forget + PII sanitization pattern ([lib/billing/events.ts](lib/billing/events.ts)); request logging ([lib/logRequest.ts](lib/logRequest.ts)) | `ActivityLog` model + `emitActivity()` calls at member/file/billing transitions; org activity UI. |
| **Admin dashboard (org)** | `AdminSidebar` **role-gated nav** pattern ([components/admin/AdminSidebar.tsx](components/admin/AdminSidebar.tsx) — items have a `roles` field that auto-hides links); `DashboardShell` ([components/dashboard/DashboardShell.tsx](components/dashboard/DashboardShell.tsx)) | Org settings pages (members, roles, billing, drives, activity) gated by org role, **not** the separate platform-admin JWT. |

> **Note:** the platform `Admin` (custom JWT, [lib/admin/session.ts](lib/admin/session.ts))
> is Xenode-staff only — **org admins are users with an org role**, a different
> concept. Do not conflate the two.

---

## 8. Authorization implementation plan (extend `lib/authz`)

1. `getAccessContext` reads `session.session.activeOrganizationId`; if set, look up
   the caller's `member` row → return `{ type:"organization", userId, orgId, role }`.
   Resolve `teamId` from the request (header/path/query) when acting in a team drive.
2. Extend `objectOwnershipClause`/`bucketOwnershipClause` to branch on `ctx.scope`
   (personal → `userId`; org → `orgId` + member; team → `teamId` + team member).
3. Branch `assertObjectAccess`/`assertBucketAccess` on `action` × role (the matrix
   in §3), backed by better-auth access-control checks.
4. Complete the route adoption started in Phase 1 — migrate remaining storage and
   sharing routes to `requireAccessContext` + the clauses (pattern in
   [lib/authz/README.md](lib/authz/README.md)). After this, org enforcement is
   uniform.
5. Extend [proxy.ts](proxy.ts) `authGate` for any org-scoped paths/subdomains.

---

## 9. API surface (new routes)

Mostly thin wrappers over the better-auth org plugin + the existing storage/billing
routes scoped by org. Indicative set:

- `app/api/orgs/**` — create/list/switch (delegate to plugin), settings.
- `app/api/orgs/[orgId]/members/**` — list/invite/remove/role-change (plugin) +
  `OrgKeyGrant` wrap/rotate side-effects.
- `app/api/orgs/[orgId]/teams/**` — team CRUD (plugin teams).
- `app/api/orgs/[orgId]/keys/**` — fetch/rotate space-key grants (E2EE §5).
- `app/api/orgs/[orgId]/billing/**` — reuse subscription create/verify/change-plan
  with `orgId` in notes; seat quantity.
- `app/api/orgs/[orgId]/activity/**` — paginated `ActivityLog`.
- Storage routes: accept org/team scope (no new routes — extend existing object/
  bucket routes via the access context).

All mutations keep the **`Idempotency-Key`** + `BillingError` conventions.

---

## 10. UI surface

- **Org switcher** in [components/dashboard/DashboardShell.tsx](components/dashboard/DashboardShell.tsx)
  (active org + personal). Reuse `setActiveOrganization`.
- **Drive switcher**: Personal / Organization / Team — drives the access scope.
- **Members & roles** page — reuse table primitives + the role-gated nav pattern.
- **Team billing & seats** page — reuse [app/(dashboard)/dashboard/billing/page.tsx](app/(dashboard)/dashboard/billing/page.tsx)
  + `SubscriptionManageCard`/`UpgradePlanModal`, scoped to org.
- **Activity log** page — reuse recharts + table.
- **Invitation accept** flow — new page + email template.

---

## 11. Migration & rollout

- **No data migration:** existing users stay personal-scope (default `ownerScope`).
- Creating/joining an org is additive; personal drive is always present.
- Feature-flag org UI until billing + key rotation are verified.
- Backfill: none required; new org `Bucket`s are created on first org-drive use.

---

## 12. Suggested build sequence (within Q1 2027)

1. **Plugin + scope plumbing** — enable `organization` plugin (+teams); `getAccessContext`
   org scope; `ownerScope/orgId/teamId` fields; finish route adoption. *(No user-facing org features yet — internal.)*
2. **Org lifecycle + members** — create/switch/invite/roles UI + email; role matrix
   in the policy layer.
3. **E2EE space keys** — `OrgKeyGrant`, wrap-on-join, **rotate-on-leave**, server-side
   share-access enforcement. *(Gate org drives behind this.)*
4. **Shared drives** — Organization + Team drives end-to-end (upload/list/move/version
   under org scope; org metering/quota).
5. **Team billing & seats** — org subscription, seat quantity, proration, invoices.
6. **Activity logs + org admin dashboard** — `ActivityLog` + admin pages.
7. **Hardening** — adversarial review of cross-tenant access, key rotation, quota
   isolation; load/seat-limit tests. Then **GA for SMBs**.

---

## 13. Risks / open questions

- **Key rotation strategy** (§5.4) — resolve key-history vs lazy re-wrap before §3-build.
- **Cross-tenant leakage** — the policy clauses are the single chokepoint; they must
  be reviewed adversarially and covered by tests (one missed `orgId` filter = a breach).
- **Seat vs member race** — enforce seat ceiling atomically (mirror the
  `adjustStorageBytes` `findOneAndUpdate` guard pattern).
- **Guest scope creep** — keep Guest strictly per-resource (DirectShare/ShareLink),
  never a space-key holder.
- **Billing boundary** — org billing must read only `OrgUsage`/`Subscription`
  (BILLING_SECURITY.md), never keys or `StorageObject` crypto.
- **Prerequisite gaps from the audit** still worth closing first: account deletion,
  security audit logging, error monitoring — they compound under multi-tenant.

---

### Quick reuse cheat-sheet
Authorization → [lib/authz](lib/authz) · Crypto sharing → [models/DirectShare.ts](models/DirectShare.ts) + [lib/crypto/fileEncryption.ts](lib/crypto/fileEncryption.ts) · Metering/quota → [lib/metering/usage.ts](lib/metering/usage.ts) · Billing → [lib/billing](lib/billing) + [lib/subscriptions/service.ts](lib/subscriptions/service.ts) · Audit/activity → [lib/billing/events.ts](lib/billing/events.ts) · Role-gated nav → [components/admin/AdminSidebar.tsx](components/admin/AdminSidebar.tsx) · Realtime sync → [lib/realtime/publish.ts](lib/realtime/publish.ts) · Email → [lib/email/notifications.ts](lib/email/notifications.ts).
