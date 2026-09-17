# Missing, broken and transitional implementations

“Implemented and working” below means a traced implementation with relevant checks where indicated; it does not imply deployed end-to-end certification. No feature is called incomplete merely for visual polish.

| Classification | Feature | Concrete evidence | Action |
| --- | --- | --- | --- |
| Implemented and working at helper/protocol level | Context-bound Vault envelopes, recovery derivation and handoff crypto | `crypto-core` 10 tests, `key-handoff` 4 tests; actual Accounts broker and product consumers | **KEEP** primitives; F01 remains an application-level flaw |
| Implemented | Accounts authority / web product OIDC | Accounts auth configuration and both `/auth/callback` routes; Drive OIDC tests pass | **KEEP / FIX** integrated MFA/session gaps |
| Implemented | Device/session list and coordinated logout | `groupAccountDevices`, logout coordinator, cleanup transactions | **KEEP**; do not equate browser session with hardware identity |
| Implemented incorrectly | Same password for login and Vault | Login → Better Auth; Vault setup → Argon2 using same value | **REPLACE F01** |
| Implemented but inconsistent with requirement | Product and ARK persistence | `crypto-react/persistent-store.ts`, `ark-cache.ts`, Drive CryptoContext | **FIX F02** |
| Implemented incorrectly, uncommitted | Combined passkey bindings / OAuth second-factor persistence | Raw collections queried using `id` and string foreign keys, bypassing Mongo adapter mapping | **FIX F03** |
| Implemented but incomplete | Password credential/envelope rotation | Staged 15-minute mutation and separate native credential update | **FIX F05** |
| Implemented but incomplete | Recovery | Phrase/PDF generation and local recovery unwrap; no complete unauthenticated credential recovery | **FIX** recovery journey without rotating away existing data |
| Planned but not currently supported | Fully passwordless product onboarding | `getAccountOnboardingReadiness` requires credential password and password envelope | **INVESTIGATE** policy, then implement deliberately |
| Implemented incorrectly under concurrency | Vault bootstrap | Product key upserts before Vault revision-zero commit | **FIX F06** |
| Legacy implementation still in use | Personal Drive RSA DEK wrapping | UploadContext → `encryptFile`/`encryptFileChunked` | **MIGRATE** to versioned product format, keep reads |
| Partially migrated | Org/team key lifecycle | Shared SpaceProductKey records, separate raw-key hook, active-only grants | **FIX F18** historic content after rotation |
| Implemented and exercised | Drive direct encrypted upload, sharing and revision helpers | UploadContext; share routes/client wraps; office/version tests | **KEEP / FIX** boundary defects, not wholesale replacement |
| Implemented incorrectly | Generic action authorization | Presign/finalize/purge and Photos mutation routes resolve membership only | **FIX F07** |
| Implemented incorrectly | Permanent deletion | Bulk-delete swallows errors; purge omits current chunks and uses obsolete owner field | **FIX F09** |
| Implemented but incomplete | Abandoned upload recovery | Drive UploadSession exists; Photos has no durable presign ledger | **FIX F10/F12/F13** |
| Implemented incorrectly for org resume | Reload upload journal | No Space/wrap/version/IV fields in UploadRecord or resumed finalize body | **FIX F17** |
| Legacy implementation still in use | Next byte proxy and server-mediated edit saves | `api/files/[bucket]/[...key]`, `applyContentUpdate` | **MIGRATE F19** under direct-storage constraint |
| Implemented but incomplete | Local-first sync | Dexie/search/read caches; timestamp-only cursor; server-authoritative mutations | **FIX F20** before adding offline edits |
| Implemented | Photos original + JPEG derivative encryption and retrieval | UploadController, photo-encryption, content route | **KEEP / FIX** CSP and cleanup |
| Implemented incorrectly | Photos album name confidentiality | AlbumEditor sends input unchanged; POST only validates string length | **FIX F15** |
| Stub / placeholder | Photos share dialog | Continue button only closes dialog | **FIX** actual grant/key flow or hide |
| Stub / placeholder | Photos album media view | AlbumView renders gradients/icons for IDs, no retrieval | **FIX** real assets and decryption |
| Stub / placeholder | Photos settings/help actions | PhotosShell buttons have no handlers/links | **LOW / FIX** wire or remove misleading affordances |
| Implemented backend, incomplete UI scale | Photos pagination/virtualization | Tuple cursor used; `getTimelineWindow` referenced only by test | **FIX F16** actual virtual rendering |
| Planned but never implemented in app | Photos delete, Bin, restore, purge | No lifecycle handlers or repository methods in standalone app | **FIX** complete lifecycle |
| Partial interface only | Photos backup/dedup | Projection service accepts fingerprint; web upload creates UUID and never submits fingerprint | **MIGRATE** a real backup adapter |
| Partial interface only | Photos video optimization | Optional `optimizeVideoForFastStart` exists but UploadController does not provide it | **MIGRATE** shared media adapter |
| Implemented incorrectly as migration | Drive projection → Photos ownership | Projection accepts Drive object; content requires Photos format; migration only changes productId | **INVESTIGATE / MIGRATE F30** |
| Transitional scaffold | Hostile Office runtime | Static editor script explicitly disabled, while app requests versioned OnlyOffice host tree | **FIX F22** deployment contract |
| Planned/unwired abstraction | Billing provider registry | `getDefaultProvider/getProvider` have no external callers; services import Razorpay | **REMOVE** or adopt only for a concrete need |
| Dead / candidate safe to remove from source graph | Old migration Redis/stream-upload helpers | No callers found; migration job routes/models removed from current app | **REMOVE** after script/build check |
| Dead operational configuration | PayU charge cron | Schedulers reference `/api/payment/payu/charge-recurring`; no matching route | **REMOVE / FIX** schedules |
| Legacy stored data, removal not yet safe | Metadata key-included decoder / old draft tables / old passkeys | Read paths and schemas remain; database population unknown | **INVESTIGATE**, never delete based only on naming |
| Planned | AI/ML semantic search, face labels, OCR | `v2_ml_plan.md`; no inference imports/runtime found | **KEEP** plan and privacy constraints; defer |
| Planned | Mail, Calendar, Notes, Tasks, Contacts, Messages | No workspaces or product implementations | **KEEP** registry extensibility; do not claim completion |

## Two-way implementations that need an explicit decision

**MIGRATE** storage and crypto contracts, not just folders: Drive/Photos completion; personal/workspace/Photos DEK formats; old Drive albums/new Photos albums; native Better Auth security endpoints/custom Accounts coordinators; Drive local UI/shared UI; generic upload queue/app-owned transport; shared realtime verifier/custom Node verifier.

**KEEP** deliberate distinctions: administrator vs user authentication; Accounts ARK vs product keys; photo albums vs Drive folders; browser processing vs server authorization; ciphertext variants vs original media. Unifying these would weaken boundaries rather than finish the refactor.
