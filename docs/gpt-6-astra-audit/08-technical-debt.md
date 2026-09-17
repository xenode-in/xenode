# Technical debt and architecture quality

Dangerous correctness defects are in the [findings register](12-findings-register.md). This chapter separates those from maintenance work that should not trigger a rewrite.

## Concentrated complexity

| File | Lines at audit | Problem and incremental action |
| --- | ---: | --- |
| `apps/drive/components/dashboard/FilePreviewDialog.tsx` | 2,404 | Media routing, key handling, fetch/cache and UI coexist. **MIGRATE** format-specific preview adapters behind the existing policy. |
| `apps/drive/components/dashboard/FilesBrowser.tsx` | 2,394 | Listing, decryption, folders, search, mutations and layout are coupled. **MIGRATE** query/mutation hooks only after Space and cursor contracts are fixed. |
| `apps/drive/contexts/UploadContext.tsx` | 1,908 | Queue plus transport, crypto, metadata, sidecars, resumability and lifecycle listeners. **MIGRATE** concrete upload adapter and durable journal out of React. |
| `apps/drive/components/organizations/OrganizationsClient.tsx` | 1,768 | Membership, key distribution, rotation and presentation share a component. **FIX** rotation first; **MIGRATE** ceremony logic into tested browser services. |
| `apps/drive/components/dashboard/FileItem.tsx` | 1,144 | Repeated list/card metadata decryption and interaction logic. **MIGRATE** one scoped metadata selector. |
| `apps/drive/lib/billing/webhooks/handlers.ts` | 970 | Many payment/subscription/refund transitions in one module. **KEEP** canonical transition semantics; split by event family only with replay tests. |
| `apps/photos/app/components/Lightbox.tsx` | 708 | A growing product component, including uncommitted visual changes. **KEEP** until resource cleanup and real-browser behavior are tested; size alone is not a defect. |

Line counts include comments/blank lines. Severity follows impact, not file length.

## Duplication with consequences

- **MEDIUM / MIGRATE:** Drive and Photos OIDC callbacks contain nearly identical code exchange and ID-token checks. Shared helpers cover PKCE/cookies, but callback orchestration is duplicated. Extract a product-configured server adapter after both real callback flows are tested.
- **HIGH / MIGRATE:** Two storage completion implementations operate on the same collection and regional bucket, with different validation, quota and compensation rules. F11–F13 are direct consequences. Centralize lifecycle semantics before moving files.
- **MEDIUM / MIGRATE:** Personal Drive metadata uses HKDF purpose derivation; workspace metadata uses the raw Space AES key; Photos uses another AAD format. Preserve these as explicit compatibility versions while choosing one format for new writes.
- **MEDIUM / MIGRATE:** Three passkey generations exist. The new combined flow is not a drop-in replacement for Accounts VaultPasskey or Drive PRF credentials; origin/RP and stored ID formats differ.
- **LOW / KEEP then MIGRATE:** Shared UI and Drive local shadcn controls coexist. Gradual imports are reasonable. Security/data ownership is a higher priority than visual unification.
- **LOW / REMOVE or adopt:** The `IBillingProvider`/RazorpayProvider registry has no callers outside its own directory. Main services call Razorpay directly. Calling the adapter canonical today would misdescribe execution.

## Performance and resource issues

**MEDIUM / FIX:** Chunked Drive encryption buffers the entire input and output; resumable download helpers concatenate cached chunks. Photos decrypts full video originals. Concurrency multiplies memory use. Test maximum supported files on constrained devices and move to bounded slices instead of merely lowering a UI file limit.

**MEDIUM / FIX:** The Photos timeline retains all loaded records and mounts all loaded tiles, with one resize listener per TimelineSection. Its window calculator is unused. Test actual rendered node count and scroll behavior; helper arithmetic tests do not cover the product.

**MEDIUM / FIX:** `useSyncManager` reads all local files and rebuilds the entire MiniSearch index every successful polling pass, using `Promise.all` for decryption. It has an unscoped cursor and no stable tie-breaker (F20). Incremental index updates should follow a corrected sync protocol.

**MEDIUM / FIX:** Preview caches implement a per-object 500 MiB admission limit and lazy TTL expiry, not a global 500 MiB cache budget. A large library can accumulate many such objects until browser eviction. Add a byte budget/LRU and account/Space/version-aware keys where missing.

**LOW–MEDIUM / FIX:** Folder deletion updates documents sequentially; chunk completion HEADs each chunk serially; album validation loads all referenced assets up to 10,000; album listing is unpaginated. Bounded bulk operations can reduce latency without weakening authorization or making memory unbounded.

**MEDIUM / FIX:** Product session resolution performs readiness queries on every request, and callbacks construct a new remote JWKS resolver each time. Measure before introducing caches, and ensure any identity/readiness cache respects revocation/version changes. Blind session caching would trade query cost for authorization staleness.

## Async and consistency defects

The problematic recurring pattern is “write several resources, then best-effort compensate.” Photos completion, Accounts Vault bootstrap, password change and Office version save each have different failure windows. **FIX** using operation identities, compare-and-set transitions, durable reconciliation state and narrow compensation ownership. Do not generalize these into a single database transaction that pretends to include S3 or a payment provider.

The upload journal read/modify/write can lose concurrent chunk progress; CryptoProvider restores can race lock; async UI fetches can outlive a Space change. **FIX** with transaction/generation identifiers and tests that deliberately interleave operations.

## Types, API errors and lint

Drive still has substantial `any` usage in request payloads, local DB state, metadata and error handling. A passing typecheck means these escape hatches were accepted, not that runtime payloads are validated. **MIGRATE** validation at storage/auth boundaries to bounded schemas first; do not launch a blanket `any` cleanup before dangerous inputs are fixed.

Billing already has `BillingError`, schema parsing and normalized provider errors. Other routes mix strings, `{error}`, raw exception messages and thrown Response objects. **MIGRATE** a small shared API error contract that preserves status/code and redacts internals. Avoid leaking backend exception details from Photos storage failures to clients.

Drive lint reports 169 errors and 213 warnings. The scoped security lint fails in FileRendererControls and useRendererConfig. **FIX** a documented baseline and required CI gate; do not suppress whole rules to make the audit green. Accounts/Photos/package lint tasks passed in this run, which is useful but not a functional security result.

## Dead code and misleading documentation

**REMOVE**, after a caller/build check: unreferenced Drive migration Redis/stream-upload helpers and obsolete PayU cron invocations. **INVESTIGATE** unused provider registry and old spreadsheet draft tables before removal: persisted client data and external operators can outlive an import search.

**FIX** architectural documentation that says keys are memory-only, transfers always direct, or the shared queue implements multipart. **FIX** comments that describe `assertObjectAccess` action checking as future work when it now checks it, while `assertBucketAccess` actually discards its action argument. Such comments actively mislead future refactoring.
