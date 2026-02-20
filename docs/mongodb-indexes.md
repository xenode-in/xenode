# MongoDB Index Reference

This document describes all required indexes across Xenode's MongoDB collections.
Indexes are declared inside the Mongoose schema files in `models/`. MongoDB creates
them automatically on first connection.

---

## ApiKey

**File:** `models/ApiKey.ts`

| Index                       | Type     | Rationale                                                                                                                             |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `keyHash`                   | Unique   | Auth token lookup: `findOne({ keyHash })` — hot path on every API request                                                             |
| `userId`                    | Single   | Ownership filter base; retained for lean queries                                                                                      |
| `{ userId, createdAt: -1 }` | Compound | Covers `find({ userId }).sort({ createdAt: -1 })` and `countDocuments({ userId })` with a single index scan — no in-memory sort stage |

---

## Bucket

**File:** `models/Bucket.ts`

| Index                       | Type            | Rationale                                                                           |
| --------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `userId`                    | Single          | Base ownership filter                                                               |
| `b2BucketId`                | Unique          | Foreign-key lookups by B2 bucket identifier                                         |
| `{ userId, name }`          | Compound Unique | Prevents duplicate bucket names per user; covers `findOne({ userId, name })`        |
| `{ userId, createdAt: -1 }` | Compound        | Covers `find({ userId }).sort({ createdAt: -1 })` — the dashboard bucket-list query |

---

## StorageObject

**File:** `models/StorageObject.ts`

| Index                         | Type            | Rationale                                                                                                                |
| ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `bucketId`                    | Single          | Base bucket filter (retained)                                                                                            |
| `userId`                      | Single          | Base ownership filter (retained)                                                                                         |
| `{ bucketId, key }`           | Compound Unique | Prevents duplicate object keys per bucket; covers equality lookups                                                       |
| `{ bucketId, createdAt: -1 }` | Compound        | Covers `find({ bucketId }).sort({ createdAt: -1 })` — the primary file listing query                                     |
| `{ userId, _id }`             | Compound        | Covers `findOne({ _id, userId })` ownership checks and `aggregate($match { userId })`                                    |
| `{ key, bucketId }`           | Compound        | Enables regex-prefix scans on `key` used in folder move and system-bucket path filtering (`key: { $regex: '^prefix/' }`) |

---

## Usage

**File:** `models/Usage.ts`

| Index    | Type   | Rationale                                                                                                           |
| -------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `userId` | Unique | Point-lookup on every `findOneAndUpdate({ userId })` write path (storage increment/decrement, egress, bucket count) |

> **Note:** No additional indexes required. The unique constraint is already backed by an index and serves all hot paths.

---

## Waitlist

**File:** `models/Waitlist.ts`

| Index   | Type   | Rationale                                                              |
| ------- | ------ | ---------------------------------------------------------------------- |
| `email` | Unique | Prevents duplicate sign-ups; serves `findOne({ email })` on submission |

> **Note:** No additional indexes required. The unique constraint covers all query paths.

---

## Explain-Plan Validation

Run the regression guard script to verify all hot queries use index scans:

```bash
npx ts-node --project tsconfig.json scripts/explain-indexes.ts
```

Expected output: each query reports `IXSCAN` with `docsExamined ≈ nReturned`. The
script exits with code `1` if any query falls back to a `COLLSCAN`.
