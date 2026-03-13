# API Routes — Full Reference

All API routes live in `app/api/`. They are Next.js Route Handlers using `export async function GET/POST/PUT/DELETE(request: Request)`.

**Auth method:** Session cookie via `better-auth`. Most routes call a session check at the top. API key routes also accept `Authorization: Bearer <api_key>` header.

---

## `/api/auth/[...all]`

- **Handler:** better-auth catch-all handler
- **Methods:** GET, POST (handled internally by better-auth)
- **Covers:** login, logout, register, session, password reset, OAuth callbacks
- **Notes:** Do NOT manually add auth logic here — better-auth manages this entirely.

---

## `/api/buckets`

| Method | Description |
|---|---|
| `GET` | List all buckets owned by the authenticated user |
| `POST` | Create a new bucket (name, region, visibility settings) |

### `/api/buckets/[bucketId]`

| Method | Description |
|---|---|
| `GET` | Get single bucket metadata |
| `PATCH` | Update bucket settings (name, visibility) |
| `DELETE` | Delete bucket and all its objects from B2 + MongoDB |

---

## `/api/objects`

| Method | Description |
|---|---|
| `GET` | List objects in a bucket (query: `bucketId`, pagination, search) |
| `POST` | Create object metadata record after upload completes |
| `DELETE` | Delete one or more objects (body: array of object IDs) |

### `/api/objects/[objectId]`

| Method | Description |
|---|---|
| `GET` | Get single object metadata + presigned download URL |
| `PATCH` | Rename object or move to folder |

---

## `/api/files`

Higher-level file operations that combine object metadata + B2 operations.

| Method | Description |
|---|---|
| `GET` | Get file details with download URL |
| `POST` | Trigger presigned upload URL generation (for direct-to-B2 upload) |

---

## `/api/drive`

Google Drive-style folder navigation.

| Method | Description |
|---|---|
| `GET` | List files/folders at a given path prefix |

---

## `/api/keys`

API key management for programmatic access.

| Method | Description |
|---|---|
| `GET` | List all API keys for the user |
| `POST` | Create a new API key (set scopes, expiry, rate limits) |

### `/api/keys/[keyId]`

| Method | Description |
|---|---|
| `DELETE` | Revoke/delete an API key |
| `PATCH` | Update key metadata (name, expiry) |

---

## `/api/payment`

| Method | Description |
|---|---|
| `POST /api/payment/create` | Initiate a payment order (creates `PendingTransaction`) |
| `POST /api/payment/webhook` | Razorpay webhook — verifies signature, upgrades user plan, saves `Payment` |
| `GET /api/payment/history` | List payment history for the user |

---

## `/api/share`

| Method | Description |
|---|---|
| `POST` | Create a share link for an object (set expiry, password, max downloads) |
| `GET /api/share/[token]` | Validate share token + return file download URL |
| `DELETE /api/share/[token]` | Revoke a share link |

---

## `/api/admin`

All routes require admin session (checked against `Admin` model).

| Route | Description |
|---|---|
| `GET /api/admin/users` | List all users with stats |
| `PATCH /api/admin/users/[id]` | Update user plan/status |
| `GET /api/admin/analytics` | System-wide storage, bandwidth, revenue stats |
| `DELETE /api/admin/users/[id]` | Delete user + all their data |

---

## `/api/changelog`

| Method | Description |
|---|---|
| `GET` | Returns all changelog entries as JSON (parsed from `/content/changelog/*.mdx`) |

---

## `/api/cron`

Protected by a `CRON_SECRET` env variable (Bearer token in Authorization header).

| Route | Description |
|---|---|
| `POST /api/cron/reset-usage` | Resets monthly bandwidth counters for all users |
| `POST /api/cron/cleanup` | Deletes expired share links and orphaned objects |

---

## `/api/waitlist`

| Method | Description |
|---|---|
| `POST` | Save email to `Waitlist` collection |

---

## Error Response Format

All API routes return consistent JSON errors:

```json
{
  "error": "Human readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

HTTP status codes follow REST conventions (400 bad request, 401 unauthenticated, 403 forbidden, 404 not found, 500 server error).
