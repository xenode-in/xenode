# MongoDB indexes

Indexes are declared in Mongoose schemas. This migration assumes a clean reseed;
do not carry historical indexes forward implicitly.

## Critical invariants

- `StorageObject` authorization/listing indexes are Space- and bucket-scoped.
- `{ bucketId, key }` is the single unique object-key index. The reversed
  `{ key, bucketId }` duplicate is intentionally absent.
- No single-field `deletedAt` index is declared. The historical
  `deletedAt_1` TTL index could delete database rows before B2 blobs and must not
  exist. Bin listing uses compound bucket/deletion indexes; purge is an
  authenticated cron workflow.
- `Bucket.systemKey` and `Bucket.b2BucketId` each have exactly one unique index,
  declared at the field level.
- ProductSession lookup/revocation and KeyHandoff expiry indexes live in
  `packages/database`.

## StorageObject hot paths

| Index | Purpose |
| --- | --- |
| `{ bucketId, key }` unique | Object identity inside the system bucket |
| `{ bucketId, createdAt: -1 }` | Primary bucket listing |
| `{ spaceId, _id }` | Tenant-scoped point authorization |
| `{ spaceId, createdAt: -1 }` | Space listing |
| `{ bucketId, deletedAt, createdAt: -1, _id: -1 }` | Bin listing and cursor order |
| `{ bucketId, deletedAt, size: -1, _id: -1 }` | Bin size sorting |
| `{ bucketId, deletedAt, contentType, _id: -1 }` | Content-type listing |
| `active_sync_content_unique` | Active mobile sync deduplication |

Regression coverage in `apps/drive/tests/security/index-cleanup.test.ts` asserts
that the TTL hazard is absent and Bucket uniqueness indexes are not duplicated.
