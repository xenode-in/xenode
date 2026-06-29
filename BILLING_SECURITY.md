# Xenode — Billing & E2EE Security Architecture

This document defines the security contracts between the billing/payment layer and the E2EE key management system.

---

## Zero-Knowledge Billing Contract

The following rules are **non-negotiable** and enforced by code, lint rules, and this document:

### 1. Billing routes must NEVER access key material

All files under `app/api/payment/**` are **prohibited** from importing:
- `UserKeyVault` model
- `StorageObject.encryptedDEK`
- `StorageObject.iv`
- `StorageObject.chunkIvs`
- Any value from `lib/crypto/**`

ESLint `no-restricted-imports` enforces this. See `.eslintrc` for the rule.

### 2. Object keys must be opaque

`StorageObject.key` stores a random hex path: `users/{userId}/{randomHex32}`

The original filename **only** lives in `StorageObject.encryptedName` (AES-GCM encrypted, client-side only). No server-side code may read `encryptedName` as plaintext — it is an opaque blob to the server.

### 3. Billing events must not log file metadata

`payuResponse` in the `Payment` model stores only:
```
{ status, txnid, mode, PG_TYPE, bank_ref_num }
```
PII fields (email, phone, name, udf1) are stripped before persistence.

### 4. Storage quota operates on bytes only

The billing system interacts with `Usage.totalStorageBytes` and `Usage.storageLimitBytes` **only**. It never inspects individual `StorageObject` records for quota enforcement. File count (`totalObjects`) is a secondary metric.

### 5. Refund & Expiry policy

Xenode offers a **14-day refund policy** for all paid plans.

When a plan expires or a subscription is cancelled:
- **New uploads are blocked** (HTTP 402) if usage exceeds the free tier limit.
- **Reads and deletes are always allowed** — the user must be able to reclaim space.
- **Auto-deletion of encrypted files is strictly forbidden** — the server does not hold decryption keys.
- A grace notification must be sent (email integration: PENDING).

### 6. PendingTransaction TTL

`PendingTransaction` records auto-expire after 1 hour via MongoDB TTL index. This limits the window for replay attacks against the payment callback.

---

## Connection Architecture

```
Next.js API Layer
    │
    ├── lib/mongodb.ts          ← Single Mongoose connection (singleton)
    │       │
    │       └── mongoose.connection.db  ← Shared with better-auth adapter
    │
    ├── app/api/payment/**      ← Billing boundary (no key vault access)
    ├── app/api/objects/**      ← Storage boundary (opaque keys only)
    └── app/api/keys/**         ← E2EE boundary (no billing access)
```

---

## Cron Jobs

| Route | Schedule | Purpose |
|-------|----------|---------|
| `/api/cron/expire-plans` | `0 0 * * *` (daily midnight UTC) | Expire lapsed plans and reset to free tier |

All cron routes require `Authorization: Bearer {CRON_SECRET}` header.

---

## ESLint Billing Boundary Rule

Add to your ESLint config to enforce the billing/E2EE separation:

```js
// In eslint.config.mjs or .eslintrc.js
{
  files: ["app/api/payment/**/*.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/UserKeyVault*", "**/lib/crypto/**"],
            message: "Billing routes must not access E2EE key material. See BILLING_SECURITY.md."
          }
        ]
      }
    ]
  }
}
```
