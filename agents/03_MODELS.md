# MongoDB Models — Schema Reference

All models live in `/models/`. They use **Mongoose** with TypeScript interfaces. The main DB connection is `lib/mongodb.ts`. Logs use a separate connection at `lib/mongodb-logs.ts`.

---

## Admin (`models/Admin.ts`)

Stores admin accounts separately from regular users (better-auth manages regular users in its own collection).

```typescript
{
  email: string;          // Admin email (unique)
  passwordHash: string;   // bcrypt hashed password
  name: string;
  createdAt: Date;
  lastLoginAt: Date;
}
```

---

## ApiKey (`models/ApiKey.ts`)

Programmatic access keys. Each key is hashed before storage — the raw key is only shown once at creation.

```typescript
{
  userId: ObjectId;         // References better-auth user
  name: string;             // Human label (e.g. "Production Key")
  keyHash: string;          // bcrypt hash of the raw key
  prefix: string;           // First 8 chars shown in UI (e.g. "xn_live_")
  scopes: string[];         // e.g. ["read:objects", "write:objects", "delete:objects"]
  expiresAt: Date | null;   // null = never expires
  lastUsedAt: Date | null;
  rateLimit: number;        // Max requests/minute (default: 60)
  isActive: boolean;
  createdAt: Date;
}
```

**Scopes available:** `read:objects`, `write:objects`, `delete:objects`, `read:buckets`, `write:buckets`

---

## ApiLog (`models/ApiLog.ts`)

Every API key request is logged here. Stored in the **logs MongoDB connection** (separate DB).

```typescript
{
  apiKeyId: ObjectId;       // Which API key was used
  userId: ObjectId;         // Who made the request
  endpoint: string;         // e.g. "/api/objects"
  method: string;           // GET, POST, etc.
  statusCode: number;       // HTTP response status
  responseTimeMs: number;   // Request duration
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
}
```

---

## Bucket (`models/Bucket.ts`)

Logical container for objects. Maps to a B2 bucket prefix (all objects in this bucket use `bucketId` as part of their B2 key path).

```typescript
{
  userId: ObjectId;           // Owner
  name: string;               // Display name (unique per user)
  slug: string;               // URL-safe identifier
  b2BucketId: string;         // Backblaze B2 bucket ID
  region: string;             // B2 region (e.g. "us-west-002")
  isPublic: boolean;          // Public = objects accessible without auth
  totalSize: number;          // Bytes (updated on upload/delete)
  objectCount: number;        // Updated on upload/delete
  createdAt: Date;
  updatedAt: Date;
}
```

---

## StorageObject (`models/StorageObject.ts`)

The core model — represents a single file stored in B2.

```typescript
{
  bucketId: ObjectId;           // Parent bucket
  userId: ObjectId;             // Owner
  name: string;                 // Display filename (e.g. "photo.jpg")
  b2Key: string;                // Full B2 object key (path within B2 bucket)
  b2FileId: string;             // B2 file ID (for delete/copy operations)
  size: number;                 // Bytes
  mimeType: string;             // e.g. "image/jpeg"
  extension: string;            // e.g. "jpg"
  folderPath: string;           // Virtual folder path (e.g. "/photos/2024/")
  isEncrypted: boolean;         // Was AES-GCM encryption applied?
  encryptionIv: string | null;  // IV used for AES-GCM (if encrypted)
  checksum: string | null;      // SHA-256 hash for integrity
  downloadCount: number;        // Total times downloaded
  lastAccessedAt: Date | null;
  metadata: Record<string, string>;  // Custom user metadata
  createdAt: Date;
  updatedAt: Date;
}
```

**Important:** Binary data is NEVER stored in MongoDB — only metadata. The actual file lives in Backblaze B2 at `b2Key`.

---

## ShareLink (`models/ShareLink.ts`)

Public share links for objects. The `token` is a random UUID included in the share URL.

```typescript
{
  objectId: ObjectId;           // The StorageObject being shared
  userId: ObjectId;             // Who created the share
  token: string;                // Random token (part of public URL)
  password: string | null;      // bcrypt hash if password protected
  expiresAt: Date | null;       // null = never expires
  maxDownloads: number | null;  // null = unlimited
  downloadCount: number;        // Current download count
  isActive: boolean;
  allowPreview: boolean;        // Can be previewed in browser (not just downloaded)
  createdAt: Date;
}
```

---

## Usage (`models/Usage.ts`)

Tracks monthly bandwidth and storage per user. Reset monthly by the cron job.

```typescript
{
  userId: ObjectId;
  month: string;              // Format: "2024-01" (year-month)
  storageUsedBytes: number;   // Current storage used
  bandwidthUsedBytes: number; // Bandwidth consumed this month
  uploadCount: number;        // Files uploaded this month
  downloadCount: number;      // Files downloaded this month
  storageLimit: number;       // Plan limit in bytes
  bandwidthLimit: number;     // Plan limit in bytes
  updatedAt: Date;
}
```

---

## Payment (`models/Payment.ts`)

Completed, verified payment records.

```typescript
{
  userId: ObjectId;
  razorpayPaymentId: string;  // Payment gateway ID
  razorpayOrderId: string;
  amount: number;             // In smallest currency unit (paise for INR)
  currency: string;           // e.g. "INR"
  plan: string;               // e.g. "pro", "enterprise"
  status: "captured" | "failed" | "refunded";
  createdAt: Date;
}
```

---

## PendingTransaction (`models/PendingTransaction.ts`)

Temporary record created when a payment is initiated, before webhook confirmation.

```typescript
{
  userId: ObjectId;
  razorpayOrderId: string;   // Used to match incoming webhook
  plan: string;
  amount: number;
  createdAt: Date;           // TTL index — auto-deleted after 24 hours
}
```

---

## UserKeyVault (`models/UserKeyVault.ts`)

Stores the user's encryption key (wrapped/encrypted) for the AES-GCM feature. The raw AES key is NEVER stored — only the key encrypted with a password-derived key.

```typescript
{
  userId: ObjectId;           // One record per user
  encryptedKey: string;       // AES key encrypted with PBKDF2-derived key
  salt: string;               // PBKDF2 salt
  iv: string;                 // IV used to encrypt the key itself
  createdAt: Date;
  updatedAt: Date;
}
```

---

## Waitlist (`models/Waitlist.ts`)

```typescript
{
  email: string;     // Unique
  createdAt: Date;
  source: string;    // Where they signed up from (e.g. "homepage", "blog")
}
```
