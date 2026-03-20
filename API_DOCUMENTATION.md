# Xenode API Documentation (Mobile Application Guide)

This document is the authoritative guide for integrating the Xenode mobile application with the Next.js backend. It focuses on the core workflows required for a seamless, secure, and performant mobile experience, specifically handling End-to-End Encryption (E2EE), large file chunking, and direct-to-storage uploads.

---

## 1. Authentication & Security

### 1.1 Authentication
The mobile application should authenticate using one of two methods:
*   **Session Cookies:** If using a WebView or a framework that shares cookies with the browser, the app can rely on `better-auth` session cookies managed via `/api/auth/[...all]`.
*   **API Keys (Recommended for Native):** Users can generate long-lived API keys via the web dashboard (or via `POST /api/keys`). The mobile app should send this key in the `Authorization` header as a Bearer token: `Authorization: Bearer <fullKey>`.

### 1.2 Client-Side E2EE (End-to-End Encryption)
Xenode's backend is "zero-knowledge" regarding encrypted file contents. **The mobile application is strictly responsible for:**
1.  Encrypting the file locally before uploading.
2.  Generating the `encryptedDEK` (Data Encryption Key) and `iv` (Initialization Vector).
3.  Sending the encrypted binary to Backblaze B2.
4.  Sending the *metadata* (`encryptedDEK`, `iv`, `encryptedName`) to the Next.js backend.
The Next.js backend *never* sees the raw file or the unencrypted DEK.

---

## 2. Core Mobile Workflows

### 2.1 The 3-Step Upload Flow (Direct-to-B2)
To minimize server load and improve upload speeds, the mobile app must upload files directly to Backblaze B2 using a pre-signed URL.

#### Step 1: Request Pre-signed URL
Before uploading, the app must request permission and a URL. The server will check storage quotas here.

*   **Endpoint:** `POST /api/objects/presign-upload` (or `/api/objects/presign-upload-multipart` for very large files).
*   **Body:**
    ```json
    {
      "bucketId": "65abc123...",
      "fileSize": 1048576,
      "fileType": "image/jpeg",
      "fileName": "photo.jpg",
      "prefix": "users/user_id/folder/" // Optional virtual path
    }
    ```
*   **Response (200 OK):**
    ```json
    {
      "uploadUrl": "https://s3.us-west-004.backblazeb2.com/...",
      "objectKey": "users/user_id/folder/photo.jpg",
      "bucketId": "65abc123..."
    }
    ```
*   **Error (402 Payment Required):**
    ```json
    {
      "error": "storage_quota_exceeded",
      "message": "You have reached your storage limit. Please upgrade your plan or delete files.",
      "currentBytes": 5000000000,
      "limitBytes": 5000000000
    }
    ```

#### Step 2: Direct Upload (Mobile Client -> Backblaze B2)
Using the `uploadUrl` from Step 1, the mobile app performs an HTTP `PUT` request directly to the Backblaze B2 bucket. This is ideal for background upload tasks.

*   **Method:** `PUT`
*   **URL:** `<uploadUrl from Step 1>`
*   **Headers:** `Content-Type: <fileType from Step 1>`
*   **Body:** The raw (or locally encrypted) binary file data.

#### Step 3: Complete Upload (Notify Backend)
Once the B2 upload succeeds, the mobile app must inform the Xenode backend to save the metadata, apply E2EE details, and increment the user's storage quota.

*   **Endpoint:** `POST /api/objects/complete-upload`
*   **Body:**
    ```json
    {
      "objectKey": "users/user_id/folder/photo.jpg",
      "bucketId": "65abc123...",
      "size": 1048576,
      "contentType": "image/jpeg",
      "isEncrypted": true,
      "encryptedDEK": "base64_encoded_dek...",
      "iv": "base64_encoded_iv...",
      "encryptedName": "encrypted_photo.jpg",
      "isChunked": false
    }
    ```
*   **Response (201 Created):** Returns the complete `StorageObject` metadata.

### 2.2 The Download & Decryption Flow
When a user wants to view or download a file:

1.  **Get Download URL(s):**
    *   **Endpoint:** `GET /api/objects/[id]`
    *   **Response (200 OK):**
        ```json
        {
          "url": "https://s3.us-west-004.backblazeb2.com/...", // If single file
          "chunkUrls": ["https://s3...", "https://s3..."], // If file was chunked
          "isEncrypted": true,
          "encryptedDEK": "base64...",
          "iv": "base64...",
          "encryptedName": "photo.jpg",
          "contentType": "image/jpeg"
        }
        ```
2.  **Download & Decrypt (Mobile Client):**
    *   If `isEncrypted` is `true`, the mobile app must decrypt the `encryptedDEK` using the user's local vault key.
    *   Download the binary from the `url` (or reconstruct the file sequentially from `chunkUrls`).
    *   Decrypt the stream locally before displaying or saving it to the device.

---

## 3. Complete Endpoint Reference

### 3.1 Buckets
Buckets are the top-level storage containers.

*   **List Buckets**
    *   `GET /api/buckets`
    *   **Response:** `{ "buckets": [{ "_id": "...", "name": "...", "b2BucketId": "..." }] }`
*   **Create Bucket**
    *   `POST /api/buckets`
    *   **Body:** `{ "name": "My Vault" }`
    *   *Note: Rate-limited to 5 requests per minute per user (Returns `429 Too Many Requests`).*
*   **Delete Bucket**
    *   `DELETE /api/buckets/[id]`

### 3.2 File & Folder Management (Objects)
*   **List Files/Folders**
    *   `GET /api/objects` (Supports pagination and filtering by bucket/folder)
*   **Create Virtual Folder**
    *   `POST /api/objects/folder`
    *   **Body:** `{ "name": "Documents", "parentId": "optional_parent_id", "bucketId": "..." }`
*   **Move Files/Folders**
    *   `POST /api/objects/move`
    *   **Body:** `{ "objectIds": ["id1", "id2"], "destinationFolderId": "new_parent_id" }`
*   **Update Metadata (Tags/Position)**
    *   `PATCH /api/objects/[id]`
    *   **Body:** `{ "tags": ["work", "important"], "position": 1 }`
*   **Delete File/Folder**
    *   `DELETE /api/objects/[id]` (Also deletes from B2 and frees up quota)

### 3.3 Sharing & Collaboration
*   **Create Share Link**
    *   `POST /api/share`
    *   **Body:**
        ```json
        {
          "objectId": "...",
          "accessType": "download", // or "view"
          "expiresIn": 24, // hours
          "maxDownloads": 5,
          "password": "optional_cleartext_password",
          "shareEncryptedDEK": "required_if_file_is_encrypted",
          "shareKeyIv": "required_if_file_is_encrypted"
        }
        ```
    *   **Response:** Returns a public `token` and `shareUrl`.
*   **List Outbound Shares**
    *   `GET /api/share`
*   **List Inbound Shares (Shared with me)**
    *   `GET /api/share/shared-with-me`

### 3.4 Cryptographic Vault (Keys)
*   **Get Vault Config**
    *   `GET /api/keys/vault`
*   **Setup Vault**
    *   `POST /api/keys/vault`
*   **Manage API Keys**
    *   `GET /api/keys` (List up to 10 keys)
    *   `POST /api/keys` (Create key)
    *   `DELETE /api/keys/[id]` (Revoke key)

### 3.5 Syncing (Offline/Cache Support)
*   **Sync State**
    *   `GET /api/files/sync`
    *   Useful for keeping the mobile app's local SQLite/CoreData cache in sync with the remote server state without re-fetching all metadata.

---

## 4. Error Handling & Standard Responses

The API uses standard HTTP status codes. The mobile app must handle these gracefully in the UI:

| Status Code | Reason | Mobile App Action |
| :--- | :--- | :--- |
| `200` / `201` | Success / Created | Proceed normally. |
| `400` | Bad Request | Validation error (e.g., missing fields). Show error toast. |
| `401` | Unauthorized | Session expired or API Key invalid. Redirect to Login. |
| `402` | Payment Required | Storage Quota Exceeded. Prompt user to upgrade plan or delete files. |
| `403` | Forbidden | Trying to access/modify a file that doesn't belong to the user. |
| `404` | Not Found | The object, bucket, or share link no longer exists. |
| `409` | Conflict | e.g., A bucket with that name already exists. |
| `429` | Too Many Requests | Rate limit hit (e.g., creating too many buckets). Show "Please wait" message. |
| `500` / `502` | Server Error | Backend issue or B2 communication failure. Retry with exponential backoff. |

## 5. Mobile Authentication Guide (better-auth)

The Xenode backend uses `better-auth` with the `@better-auth/expo` plugin, providing robust session management for React Native / Expo mobile applications.

### 5.1 Initialization in React Native / Expo
The mobile app should initialize the `better-auth` client specifically for React Native. Do not manually hit the `/api/auth/*` REST endpoints for standard login flows; use the client SDK.

```typescript
// Example mobile client setup
import { createAuthClient } from "better-auth/react"
import { expoClient } from "@better-auth/expo/client"

export const authClient = createAuthClient({
    baseURL: "https://your-api-url.com", // NEXT_PUBLIC_APP_URL
    plugins: [
        expoClient({
            scheme: "xenode", // Your app's custom URL scheme for deep linking
        })
    ]
})
```

### 5.2 Email & Password Sign-Up Flow
The backend enforces strict email verification rules. A user **cannot** sign in until their email is verified.

1.  **Sign Up:** Call `authClient.signUp.email(...)`. This creates the user and automatically sends a verification email via Resend.
2.  **Verification Required:** The app must show a "Check your email" screen. The user cannot access the main app yet.
3.  **Auto Sign-In:** The backend has `autoSignInAfterVerification: true`. When the user clicks the link in their email on their phone, it should deep link back into the app. Because of auto sign-in, the session will immediately become valid.
4.  **Resending Emails (Rate Limited):** If the user needs another email, call the resend function. **Important:** The `/send-verification-email` endpoint is rate-limited to **3 requests per 10 minutes**. The mobile UI must handle the `429 Too Many Requests` error gracefully if the user spams the button.

### 5.3 Google OAuth Flow
Google OAuth is configured strictly for **Account Linking and Sign-In Only**.

*   **Sign-Up is Disabled:** The backend configuration explicitly sets `disableSignUp: true` for Google OAuth. A user **cannot** create a new account using "Continue with Google". They must sign up via Email/Password first.
*   **Sign-In:** If a user already has an account, they can use Google to sign in (provided the emails match and account linking is enabled).
*   **Redirect URIs:** The backend whitelists `xenode://`, `xenode://*`, and `exp://*` (in development). The mobile app must use these custom schemes as the redirect URI after completing the web-based Google OAuth flow.

### 5.4 Session Lifecycle & Custom Fields
*   **Session Expiry:** Sessions last for 7 days (`60 * 60 * 24 * 7`).
*   **Silent Refresh:** Sessions are automatically refreshed every 24 hours (`60 * 60 * 24`). The mobile app should check the session state when the app foregrounds to ensure it stays fresh.
*   **Custom User Properties:** The session object includes custom fields that the mobile app must respect:
    *   `user.onboarded` (boolean): If `false` upon login, the mobile app must route the user to an onboarding screen. Once the user completes onboarding, the app should call `POST /api/onboarding/complete` to set this to `true`.
    *   `user.encryptByDefault` (boolean): If `true`, the mobile app UI should default all new file uploads to End-to-End Encrypted mode.
