# Contexts, Hooks & Providers

This file documents all React Context providers, custom hooks, and app-level providers.

---

## Contexts (`contexts/`)

### `contexts/UploadContext.tsx` — Upload State Manager

The most complex context. Manages the entire Uppy upload lifecycle.

**Provides:**
- `uppy` — The configured Uppy instance
- `isUploading: boolean` — Whether an upload is in progress
- `uploads: UploadItem[]` — Array of current upload items with progress
- `startUpload(files, bucketId, options)` — Initiate upload
- `cancelUpload(fileId)` — Cancel a specific upload
- `currentBucketId: string` — The bucket being uploaded to

**Internal flow:**
1. Gets presigned S3 PUT URL from `/api/files` (POST)
2. Uppy uploads directly to Backblaze B2 using the presigned URL
3. On success, calls `/api/objects` (POST) to save metadata to MongoDB
4. If encryption is enabled (from CryptoContext), encrypts file before Uppy picks it up

**Used in:** `components/upload/UploadModal.tsx`, `components/upload/UploadProgress.tsx`

---

### `contexts/CryptoContext.tsx` — Encryption State

Manages the user's AES-GCM encryption key in memory.

**Provides:**
- `isEncryptionEnabled: boolean` — Whether user has encryption turned on
- `isUnlocked: boolean` — Whether the key vault is currently unlocked (key in memory)
- `unlockVault(password)` — Derives key from password + salt, stores in memory
- `lockVault()` — Clears key from memory
- `encryptFile(file)` — Returns `{ encryptedFile, iv }` using the in-memory key
- `decryptFile(buffer, iv)` — Returns decrypted `ArrayBuffer`

**Notes:**
- The raw AES key is only held in memory — never persisted to localStorage or cookies
- If the user navigates away, they must re-enter their password to unlock again

---

### `contexts/DownloadContext.tsx` — Download Queue

Manages multiple concurrent downloads with progress tracking.

**Provides:**
- `downloads: DownloadItem[]` — Active downloads with progress
- `downloadFile(objectId, fileName, isEncrypted, iv?)` — Initiates a download
  - Fetches presigned URL from `/api/objects/[objectId]`
  - For encrypted files: fetches bytes → decrypts → triggers browser download
  - For plain files: opens presigned URL directly
- `cancelDownload(objectId)` — Cancels an in-progress download

---

### `contexts/PreviewContext.tsx` — File Preview Modal

Controls the global file preview modal state.

**Provides:**
- `previewObject: StorageObject | null` — The file currently being previewed
- `openPreview(object)` — Opens the preview modal for a file
- `closePreview()` — Closes the modal

---

## Hooks (`hooks/`)

### `hooks/useChunkedVideoPreview.ts`

Handles streaming video preview for large video files. Instead of loading the full video, it fetches a small chunk using HTTP Range requests to generate a quick preview.

**Usage:**
```typescript
const { previewUrl, isLoading, error } = useChunkedVideoPreview(objectId);
```

**Flow:**
1. Fetches presigned URL for the object
2. Uses `fetch` with `Range: bytes=0-2097152` (first 2MB)
3. Creates a Blob URL from the chunk for `<video>` src
4. Cleans up Blob URL on unmount

---

## Providers (`providers/`)

### `providers/PostHogProvider.tsx`

Initializes client-side PostHog and identifies the logged-in user.

```tsx
// In app/layout.tsx:
<PostHogProvider>
  {children}
</PostHogProvider>
```

- Reads `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` from env
- Automatically tracks page views on route changes
- Calls `posthog.identify(userId)` when session is available

---

## Provider Nesting Order

The full provider nesting in `app/layout.tsx`:

```tsx
<ThemeProvider>          ← next-themes (dark/light mode)
  <PostHogProvider>      ← analytics
    <SmoothScrollWrapper> ← Lenis scroll
      <CryptoProvider>   ← encryption key vault
        <DownloadProvider> ← download queue
          <UploadProvider> ← upload manager
            <PreviewProvider> ← file preview modal
              {children}
            </PreviewProvider>
          </UploadProvider>
        </DownloadProvider>
      </CryptoProvider>
    </SmoothScrollWrapper>
  </PostHogProvider>
</ThemeProvider>
```

**Important:** `CryptoProvider` must wrap `UploadProvider` because upload needs access to `encryptFile()`.
