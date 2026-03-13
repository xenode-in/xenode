# lib/ — Utilities, Services & Helpers

The `lib/` directory contains all server-side utilities, service integrations, and shared helpers. Nothing in `lib/` renders UI.

---

## Database Connections

### `lib/mongodb.ts` — Main Database

Mongoose connection singleton. Uses global caching to avoid re-connecting on every hot reload in development.

```typescript
import dbConnect from '@/lib/mongodb';
await dbConnect(); // Call at the top of any API route that needs DB
```

- Connection string: `MONGODB_URI` env var
- Pattern: Cached in `global._mongoose` to survive Next.js hot reloads

### `lib/mongodb-logs.ts` — Logs Database

Separate Mongoose connection for `ApiLog` writes. Kept separate so heavy log writes don't impact the main DB connection pool.

- Connection string: `MONGODB_LOGS_URI` env var

---

## `lib/auth/` — Authentication

better-auth configuration and server-side session helpers.

- **`lib/auth/auth.ts`** — better-auth server instance (configured with MongoDB adapter)
- **`lib/auth/auth-client.ts`** — Client-side better-auth hooks (`useSession`, `signIn`, `signOut`)

Usage in API routes:
```typescript
import { auth } from '@/lib/auth/auth';
const session = await auth.api.getSession({ headers: request.headers });
if (!session) return new Response('Unauthorized', { status: 401 });
const userId = session.user.id;
```

---

## `lib/b2/` — Backblaze B2 Storage

All S3-compatible operations against Backblaze B2.

- **`lib/b2/client.ts`** — Creates the `S3Client` with B2 endpoint and credentials
- **`lib/b2/operations.ts`** — Helper functions:
  - `generatePresignedUploadUrl(key, bucketName, expiresIn)` — Returns a presigned PUT URL for direct browser upload
  - `generatePresignedDownloadUrl(key, bucketName, expiresIn)` — Returns a presigned GET URL for download
  - `deleteObject(key, bucketName)` — Deletes a file from B2
  - `copyObject(sourceKey, destKey, bucketName)` — Copies a file within B2
  - `listObjects(prefix, bucketName)` — Lists objects with a path prefix

**Environment variables needed:**
```
B2_APPLICATION_KEY_ID=
B2_APPLICATION_KEY=
B2_BUCKET_NAME=
B2_ENDPOINT=https://s3.us-west-002.backblazeb2.com
B2_REGION=us-west-002
```

---

## `lib/crypto/` — AES-GCM Encryption

Client-side encryption using the **Web Crypto API**. Files are encrypted in the browser before upload and decrypted after download.

- **`lib/crypto/encrypt.ts`** — `encryptFile(file, key)` → returns `{ encryptedBuffer, iv }`
- **`lib/crypto/decrypt.ts`** — `decryptFile(encryptedBuffer, key, iv)` → returns decrypted `ArrayBuffer`
- **`lib/crypto/keyUtils.ts`** — Key derivation (PBKDF2 → AES-GCM key), key wrap/unwrap utilities

**Flow:**
1. User unlocks vault with password → PBKDF2 derives a wrapping key → Unwraps AES key from `UserKeyVault`
2. On upload: file encrypted in browser → encrypted bytes sent to B2 → `isEncrypted: true` + `encryptionIv` saved to `StorageObject`
3. On download: encrypted bytes fetched from B2 → decrypted in browser using the AES key from vault

---

## `lib/cache/` — Caching Layer

In-memory cache (Map-based) for server-side data that is expensive to recompute.

- **`lib/cache/index.ts`** — Generic `Cache<T>` class with TTL support

---

## `lib/downloadCache.ts` — Presigned URL Cache

Presigned download URLs from B2 are expensive to generate and are valid for a configurable period. This module caches them per `objectId` to avoid redundant B2 API calls.

```typescript
import { getCachedDownloadUrl } from '@/lib/downloadCache';
const url = await getCachedDownloadUrl(objectId, b2Key, bucketName);
// Returns cached URL if valid, otherwise generates new one
```

- Default cache TTL: 55 minutes (B2 presigned URLs valid for 60 min)
- Cached in Node.js process memory (not Redis)

---

## `lib/metering/` — Usage Metering

Updates the `Usage` model when files are uploaded or downloaded.

- **`lib/metering/trackUpload.ts`** — `trackUpload(userId, bytes)` — Increments `storageUsedBytes` + `uploadCount`
- **`lib/metering/trackDownload.ts`** — `trackDownload(userId, bytes)` — Increments `bandwidthUsedBytes` + `downloadCount`
- **`lib/metering/checkLimits.ts`** — `checkStorageLimit(userId)` / `checkBandwidthLimit(userId)` — Returns boolean, used to block uploads/downloads when plan limits are exceeded

---

## `lib/logRequest.ts` — API Request Logger

Middleware helper called at the end of API key-authenticated routes.

```typescript
import { logRequest } from '@/lib/logRequest';
await logRequest({ apiKeyId, userId, endpoint, method, statusCode, responseTimeMs, request });
```

Writes to `ApiLog` via the logs DB connection.

---

## `lib/admin/` — Admin Utilities

Helpers for admin API routes.

- **`lib/admin/auth.ts`** — `verifyAdminSession(request)` — Checks if request has a valid admin session
- **`lib/admin/stats.ts`** — Aggregation queries for system-wide analytics

---

## `lib/blog.ts` — Blog Parser

Reads `.mdx` files from `content/blog/` and parses frontmatter.

```typescript
getAllBlogPosts()     // Returns array of { slug, title, date, excerpt, readingTime }
getBlogPost(slug)     // Returns full MDX content + frontmatter
```

Frontmatter schema:
```yaml
---
title: "Post Title"
date: "2024-01-15"
excerpt: "Short description"
author: "Name"
tags: ["storage", "release"]
---
```

---

## `lib/changelog.ts` — Changelog Parser

Same pattern as `lib/blog.ts` but reads from `content/changelog/`.

---

## `lib/posthog.ts` — Analytics

Server-side PostHog client for tracking events from API routes.

```typescript
import { posthog } from '@/lib/posthog';
posthog.capture({ distinctId: userId, event: 'file_uploaded', properties: { size, mimeType } });
```

- Client-side PostHog is initialized in `providers/PostHogProvider.tsx`

---

## `lib/utils.ts` — General Utilities

```typescript
cn(...classes)  // tailwind-merge + clsx — use this for all className merging
```

---

## `lib/validations.ts` — Zod Schemas

Shared Zod schemas for validating API request bodies. Import these in both API routes and client-side forms.

```typescript
createBucketSchema
createApiKeySchema
shareObjectSchema
// etc.
```
