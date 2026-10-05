# Storage pool provisioning

`STORAGE_ENABLED_REGIONS` is a non-secret comma-separated deployment setting
shared by Accounts, Drive and Photos. It defaults to `asia`, must contain that
default pool, and may additionally contain `us` and `eu` without duplicates.
Accounts receives only this list, never storage credentials. Onboarding and
organization creation show and accept only enabled choices.

The internal `asia` identifier means the default pool. Its display name is
“Default storage”; no physical Asia placement is inferred from it. US and EU
pools require their matching jurisdiction endpoints. Cloudflare documents that
[location hints are best effort, while jurisdiction restrictions constrain storage](https://developers.cloudflare.com/r2/reference/data-location/).

## Configuration

Every enabled pool needs an explicit bucket name, HTTPS R2 endpoint, key ID and
application key. `S3_REGION` is always `auto` (the fixed signing region, not a
geographic location). Default pool settings use `S3_*`; US/EU use `S3_US_*` and
`S3_EU_*`. All variables for a disabled pool must remain empty. Bucket names
must be distinct across enabled pools, including pools on different accounts,
because signed-download routes identify the pool by bucket name.

Endpoints contain no credentials, ports, paths, query or fragment. US uses
`https://<account>.us.r2.cloudflarestorage.com`; EU uses the equivalent `.eu.`
endpoint. Signing/configuration follows [R2's S3 contract](https://developers.cloudflare.com/r2/api/s3/api/).

Products validate complete and distinct provisioning at Node runtime startup.
Accounts validates only the non-secret list. Builds do not invoke these runtime
checks and require no storage credentials or database. Region resolution never
supplies a bucket name or endpoint fallback; unknown/ambiguous bucket names and
corrupt owner-region values fail closed. Unassigned owners use the explicitly
provisioned default pool.

## Provisioning and development seed

Provision buckets outside Xenode, verify their intended jurisdiction/location,
credentials and exact-origin CORS, then declare them enabled. Xenode never
creates a physical bucket during a user request. HeadBucket verification must
succeed before its metadata is created. Failure to verify a bucket is an error,
not permission to assume it exists. Existing metadata must match configuration
exactly; it is never relabelled to a different pool.

For fresh disposable development storage, run from the repository root:

```powershell
npm run seed:storage-buckets --workspace @xenode/drive
```

The seed validates configuration, refuses populated storage/ledger/share
collections, verifies every enabled bucket before creating records, and inserts
only the enabled pool mappings. The old regional migration/backfill script is
removed. Reset obsolete development data rather than rewriting object/share
references or guessing their physical location.

Account onboarding records the pool, preferences, identity changes and audit
event in one transaction. Competing initial choices cannot overwrite each
other, and an already selected pool cannot be changed by another request.

## API contract

On the Accounts origin, authenticated `POST /api/onboarding/complete` requires
a JSON `region` of `asia`, `us` or `eu` that is in `STORAGE_ENABLED_REGIONS`.
It also accepts the existing `username`, `theme`, `defaultEncrypt` and `image`
preferences; an account without a username must supply one. A successful
request returns HTTP 200 with `{ "ok": true, "storageRegion": "asia" }`
(using the chosen value). Missing, unknown or disabled pools return 400 before
writes. A different previously locked choice or a competing initial choice
returns 409. Session, second-factor and per-account rate-limit policies still
apply. This is the Accounts endpoint; Drive's same-named onboarding endpoint
does not select the account pool.

On the Drive origin, authenticated `POST /api/orgs` accepts `storageRegion`
alongside its organization-creation fields. Omission uses the caller's selected
pool; an explicit choice must be supported and enabled. A disabled effective
pool returns 400 before any organization, membership or usage record is
created. Success returns 201 with `storageRegion` and `defaultBucketReady: true`
after physical bucket verification and creation-only metadata setup.

## Verification limits

Tests use disposable MongoDB and mocked R2 responses. They cover missing and
partial configuration, disabled and duplicate pools, jurisdiction mismatch,
unknown/ambiguous reverse mapping, failed physical verification, immutable
metadata and concurrent account/bucket choices. Live bucket location,
credentials, CORS and regional upload/download/delete remain release gates;
configuration labels alone do not establish those results.
