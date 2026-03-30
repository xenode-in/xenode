# E2EE Streaming Migration Guide

## ❌ Remove
- useChunkedVideoPreview (blob based)
- Any Blob URL video playback

## ✅ Use
- useMSEStream
- StreamVideoPlayer

## Example

```tsx
<StreamVideoPlayer
  streamOpts={{
    urls: chunkUrls,
    dek,
    chunkIvs,
    contentType,
  }}
  type={contentType}
/>
```

## ⚠️ Requirements

1. Video must be **fast-start MP4**
   ```bash
   ffmpeg -i input.mp4 -movflags +faststart output.mp4
   ```

2. Chunk size: 512KB – 2MB

3. Each chunk must be independently encrypted (already done ✅)

## 🚀 Result

- Instant playback
- Progressive buffering
- No full download blocking
- True E2EE preserved
