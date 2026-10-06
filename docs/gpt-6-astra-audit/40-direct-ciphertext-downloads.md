# Direct ciphertext download contract

Drive and Photos authorize metadata requests in their own product and Space.
Browsers fetch ciphertext directly from private R2 S3 endpoints using SigV4
GetObject URLs. Next never receives browser file bytes. The retired HMAC file
proxy, Azure CDN setting and proxy signing secret are removed.

Drive's signing seam is `lib/b2/cdn.ts`, used by `getDownloadUrl`, object and
thumbnail listings, and link/album/direct-share readers. The physical bucket
must resolve to exactly one enabled region. Each URL binds the bucket and exact
key. Revision keys are immutable; no synthetic cache version or provider
version-id is needed.

Lifetime is at most 300 seconds. Session-gated issuance rounds down to the
ProductSession deadline; link/album issuance rounds down to the share deadline.
Expired deadlines do not mint URLs. A public download allowance is claimed
atomically after signing and before returning any URL, rechecking revocation,
expiry and the observed share revision. Preview does not consume the allowance.
Revocation prevents new signatures; an issued URL remains usable for its
bounded lifetime. Downloaded plaintext cannot be remotely erased.

Capability JSON and signed ciphertext responses use `private, no-store`.
GetObject response overrides request octet-stream/attachment semantics and
no-store. Signed listing responses are not retained in Redis across accounts
or authorization deadlines. Decrypted thumbnails remain in bounded memory
caches. Never log full capability URLs.

`GET /api/objects/{id}/content?version={id}` returns `{ objectId, versionId,
url?, chunkUrls? }`. Authorization checks the live object, physical bucket and
selected retained version; pending-deletion snapshots are unavailable. Chunked
snapshots return ordered part URLs. The version dialog fetches parts directly,
verifies lengths and authenticates each against object/index/count before
publishing a Blob. No multipart main-key placeholder is fetched.

Range is deliberately unsigned, allowing different ciphertext ranges with
one GET capability. The service worker and MSE reader still authenticate a
complete chunk before exposing plaintext. [R2 GetObject supports Range](https://developers.cloudflare.com/r2/api/s3/api/).
[Presigned URLs use the S3 API domain](https://developers.cloudflare.com/r2/api/s3/presigned-urls/),
not a public/custom CDN domain.

Key-only thumbnail endpoints resolve a live Drive object's exact thumbnail
reference rather than accepting any key under an account prefix. Share
thumbnail access checks object/Space lifecycle and expiry/limits. Password
protected thumbnails require the verified share manifest; direct thumbnails
require a current recipient. Signing failures never return an invented URL.

For every enabled R2 pool configure CORS with exact Drive/Photos origins,
GET/HEAD/PUT, request headers Content-Type, Range and If-None-Match, and expose
ETag, Content-Length, Content-Range and Accept-Ranges. Match the create-only PUT
contract. [Cloudflare CORS guidance](https://developers.cloudflare.com/r2/buckets/cors/)
requires bucket CORS even for valid signatures. Private buckets must have no
public domain or r2.dev access; proxies must not cache capability routes.
No bucket configuration was changed by this phase.

Release checks remain: live regional GET/PUT/CORS, response overrides,
expiry/Range/seek behavior, expired URL refresh, scope/revocation and multipart
version downloads in browsers. Local signature/integration tests do not
establish provider configuration.
