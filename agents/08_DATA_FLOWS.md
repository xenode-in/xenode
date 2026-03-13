# Data Flows — Key User Journeys

This file documents the step-by-step data flow for the most important operations. Use this when debugging issues or implementing new features.

---

## 1. File Upload Flow

```
User selects files in UploadModal
        │
        ▼
UploadContext.startUpload(files, bucketId)
        │
        ▼
If encryption enabled:
  CryptoContext.encryptFile(file) → { encryptedBuffer, iv }
        │
        ▼
POST /api/files
  Body: { bucketId, fileName, mimeType, size }
  Returns: { presignedUrl, b2Key }
        │
        ▼
Uppy uploads directly to B2 using presignedUrl (PUT request)
  No Next.js server involved — browser → B2 directly
        │
        ▼
POST /api/objects
  Body: { bucketId, b2Key, fileName, size, mimeType, isEncrypted, encryptionIv }
  Action: Creates StorageObject in MongoDB, calls trackUpload(userId, bytes)
        │
        ▼
UI refreshes file list, shows success toast
```

---

## 2. File Download Flow

```
User clicks Download on a file
        │
        ▼
DownloadContext.downloadFile(objectId, fileName, isEncrypted, iv)
        │
        ▼
GET /api/objects/[objectId]
  Returns: { object metadata, presignedDownloadUrl }
  (presignedDownloadUrl served from downloadCache, or newly generated)
        │
        ▼
If NOT encrypted:
  window.location = presignedDownloadUrl  (direct B2 download)
If encrypted:
  fetch(presignedDownloadUrl) → ArrayBuffer
  CryptoContext.decryptFile(buffer, iv) → decryptedBuffer
  Create Blob from decryptedBuffer → trigger browser download
        │
        ▼
library calls trackDownload(userId, bytes) → Updates Usage
```

---

## 3. Share Link Creation Flow

```
User right-clicks file → "Share" → share-dialog opens
        │
        ▼
User sets: expiry date (optional), password (optional), max downloads (optional)
        │
        ▼
POST /api/share
  Body: { objectId, expiresAt, password, maxDownloads, allowPreview }
  Action: Creates ShareLink with random UUID token
  Returns: { token, shareUrl }
        │
        ▼
shareUrl format: https://app.com/shared/{token}
```

### Share Link Access Flow (Public)

```
Recipient visits /shared/{token}
        │
        ▼
GET /api/share/{token}
  Checks: token exists, not expired, download count < maxDownloads
  If password protected: validates submitted password (bcrypt compare)
  Returns: presigned download URL
        │
        ▼
Page shows file name, size, download button
Download button → direct B2 presigned URL
```

---

## 4. API Key Authentication Flow

```
Developer sends request:
GET /api/objects?bucketId=xxx
Headers: Authorization: Bearer xn_live_abcd1234...
        │
        ▼
API route extracts Bearer token
Hash token → compare with ApiKey.keyHash (bcrypt)
Check: isActive, not expired, has required scope
        │
        ▼
If valid: proceed with request, call logRequest()
If invalid: return 401 { error: "Invalid or expired API key" }
        │
        ▼
logRequest() writes to ApiLog (logs DB, non-blocking)
```

---

## 5. Payment / Plan Upgrade Flow

```
User clicks "Upgrade to Pro"
        │
        ▼
POST /api/payment/create
  Body: { plan: "pro" }
  Action: Creates Razorpay order + PendingTransaction record
  Returns: { orderId, amount, currency }
        │
        ▼
Client opens Razorpay checkout modal (using NEXT_PUBLIC_RAZORPAY_KEY_ID)
User completes payment
        │
        ▼
Razorpay calls POST /api/payment/webhook
  Action: Verify HMAC signature using RAZORPAY_WEBHOOK_SECRET
  Find PendingTransaction by orderId
  Create Payment record
  Delete PendingTransaction
  Update user's plan in better-auth user metadata
  Update Usage limits (storageLimit, bandwidthLimit)
        │
        ▼
UI polling or webhook response shows plan updated
```

---

## 6. Encryption Unlock Flow

```
User navigates to dashboard
CryptoContext detects: isEncryptionEnabled = true, isUnlocked = false
UI shows "Unlock Vault" prompt
        │
        ▼
User enters encryption password
CryptoContext.unlockVault(password)
        │
        ▼
Fetch UserKeyVault for userId (from /api/keys/vault or direct call)
Use password + salt → PBKDF2 → wrapping key
Decrypt encryptedKey using wrapping key + stored IV
Store raw AES-GCM key in memory (React state, never persisted)
        │
        ▼
isUnlocked = true
All subsequent uploads/downloads use the in-memory key
```
