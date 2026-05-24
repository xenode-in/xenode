# v2 ML Plan — AI/ML Features in E2EE Photo Storage

**Status:** Draft for review
**Scope:** Bringing Google Photos–style intelligence (faces, objects, semantic search) to an end-to-end encrypted photo storage system across **Android** (primary), **iOS** (later), and **Web**.
**Author:** Engineering
**Last updated:** 2026

---

## 1. Goals & Non-Negotiables

### What we're building

A photo storage product that gives users the same intelligent features they expect from Google Photos / Apple Photos, **without ever letting the server see their plaintext data.**

Target user-facing features:

1. **Face recognition** — automatic grouping of people across the library, user-named clusters ("Mom", "Anna").
2. **Object & scene tagging** — auto-tags like "beach", "dog", "food", "sunset", "document".
3. **Semantic search** — natural-language search like "my dog at the beach last summer", "screenshots with code", "birthday cake".
4. **OCR** (Phase 2) — text inside photos becomes searchable.
5. **Memories / highlights** (Phase 3) — auto-generated collections.

### Hard invariants

These cannot be violated by any feature, ever. If a proposed feature would require breaking one of these, the feature is rejected or redesigned.

| # | Invariant |
|---|-----------|
| I1 | The server **never** sees plaintext photos, thumbnails, embeddings, labels, face data, OCR text, or search queries. |
| I2 | The server **never** holds a key capable of decrypting user data. |
| I3 | All ML inference runs **on the user's device** (mobile or browser). |
| I4 | All ML-derived metadata is encrypted with the same key hierarchy as the photos themselves before leaving the device. |
| I5 | No cloud ML APIs are ever called with user content (no Google Vision API, no OpenAI, no Cloud Natural Language, nothing). |
| I6 | We cannot recover a user's data if they lose their master key (and we are honest about this). |

---

## 2. Architecture Overview

### High-level data flow

```
┌─────────────────────────────────────────────────────────────┐
│                     USER'S DEVICE                            │
│                                                              │
│  Photo → [On-device ML pipeline]                             │
│            ├─ Face detection + face embeddings               │
│            ├─ Object/scene labels                            │
│            ├─ CLIP image embedding (semantic search)         │
│            └─ Optional: OCR                                  │
│                                                              │
│  All outputs ──► [Encrypt with user's key] ──► Upload        │
│  Photo bytes ──► [Encrypt with user's key] ──► Upload        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ (ciphertext only)
┌─────────────────────────────────────────────────────────────┐
│                       SERVER                                 │
│  - Stores opaque encrypted blobs                             │
│  - Indexes by file id, user id, timestamps                   │
│  - Cannot read any content                                   │
│  - No ML, no compute on content, no thumbnails generated     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ (ciphertext blobs)
┌─────────────────────────────────────────────────────────────┐
│                  ANOTHER USER DEVICE                         │
│                                                              │
│  Download ciphertext ──► [Decrypt locally]                   │
│                              │                               │
│                              ▼                               │
│                         Display / search / cluster           │
└─────────────────────────────────────────────────────────────┘
```

### What lives on the server

- Encrypted photo blobs (AES-256-GCM)
- Encrypted thumbnails (multiple sizes, all generated client-side)
- Encrypted "ML sidecar" blobs (face data, labels, CLIP vectors, OCR)
- Encrypted file metadata (filename, capture date, EXIF)
- Per-user public keys for device handshake
- Wrapped (encrypted) master keys for each user device

### What never lives on the server

- Plaintext anything
- Decryption keys
- Search queries
- Cluster identities ("this group is Mom")
- Anything derived from photo content

---

## 3. ML Feature Specification

### 3.1 Face recognition

**Pipeline:**
1. Face detector finds bounding boxes + landmarks in each photo.
2. Each detected face is cropped, aligned, and passed through a face embedding model → 128- or 512-dimensional float vector.
3. Embeddings are clustered on-device (DBSCAN or HDBSCAN). Each cluster represents one person.
4. The user can name a cluster. The name is encrypted and synced.
5. When new photos arrive, their face embeddings are assigned to the nearest existing cluster (or start a new one if no match within threshold).

**Models:**
- **Detection:** ML Kit Face Detection (Android), MediaPipe FaceDetection (Web).
- **Embedding:** MobileFaceNet, ~5 MB int8-quantized, 512-dim output.

**Storage per photo:**
- For each face detected: bounding box, landmarks, 512-dim float embedding, cluster assignment.
- Typical photo with 3 faces: ~6 KB of face sidecar data, all encrypted.

### 3.2 Object & scene tagging

**Pipeline:**
1. Photo is passed through a multi-label classifier OR we use the CLIP embedding (see 3.3) for zero-shot classification against a fixed vocabulary.
2. Top-K labels with confidence scores are stored encrypted.

**Recommendation: skip a dedicated classifier and use CLIP zero-shot classification.** Reasons:
- We're already running CLIP for semantic search.
- CLIP zero-shot classification against a ~500-label vocabulary is competitive with dedicated classifiers for our use case.
- One fewer model to ship.

If we ship a dedicated classifier later for speed: EfficientDet-Lite0 or YOLOv8n via LiteRT.

### 3.3 Semantic search (CLIP)

This is the headline feature. Lets users type "dog at sunset" and find the photo.

**Model: MobileCLIP-S0** (Apple, open weights, available in ONNX format).
- ~50M params total (image encoder + text encoder).
- Image encoder latency: 5–15 ms on modern mobile NPU; 30–80 ms on desktop browser via WebGPU; 200–500 ms via WASM fallback.
- Output: 512-dim float embedding.
- Comparable zero-shot accuracy to OpenAI's original ViT-B/16 CLIP.

**Pipeline:**
1. On photo capture/import, run the image encoder. Store the 512-dim vector encrypted in the photo's sidecar.
2. On search:
   - User types query.
   - Run the text encoder locally on the query.
   - Fetch all encrypted CLIP vectors for the user's library (or use a local cache).
   - Decrypt them in memory.
   - Compute cosine similarity, return top-K photo ids.

**Index strategy:**
- Up to ~5,000 photos: brute-force cosine similarity in a Web Worker / background thread. Fast enough.
- 5,000–50,000 photos: build an in-memory HNSW index after decryption. Rebuild lazily as new photos are added.
- 50,000+ photos: persistent on-device HNSW index, stored encrypted on disk, decrypted on first search of a session.

**Storage per photo:** 2 KB encrypted CLIP vector.

### 3.4 OCR (Phase 2)

Use ML Kit Text Recognition on Android and Tesseract.js on Web. Extracted text is encrypted and stored per-photo. Full-text search runs client-side after decryption.

### 3.5 Memories / highlights (Phase 3)

Pure heuristic — cluster photos by date, location, and CLIP similarity. No new models. Runs entirely on-device. The "memory" itself (title, cover photo, member ids) is an encrypted blob.

---

## 4. Encryption Model

### 4.1 Key hierarchy

```
User password
   │
   ▼ Argon2id (memory=64MB, iterations=3, parallelism=1)
Account key (256-bit)
   │
   ▼ wraps
Master key (256-bit, randomly generated)
   │
   ├──▶ wraps ──▶ Per-file content key (256-bit, per photo)
   │
   └──▶ wraps ──▶ Per-collection metadata key (faces, search index, etc.)
```

- **Account key** is derived from the password on the device and never leaves it.
- **Master key** is generated once at signup, wrapped with the account key, and the wrapped form is stored on the server. New devices unwrap it after the user enters the password.
- **Per-file content keys** are generated fresh for each photo, wrapped by the master key, and stored alongside the file ciphertext.

### 4.2 What gets encrypted with what

| Data | Encryption | Notes |
|---|---|---|
| Photo bytes | AES-256-GCM with per-file content key | Standard. |
| Photo thumbnails (3 sizes) | AES-256-GCM with per-file content key | Generated client-side. |
| Face embeddings + bounding boxes for a photo | AES-256-GCM with per-file content key | Travels with the photo. |
| CLIP image embedding | AES-256-GCM with per-file content key | Travels with the photo. |
| Labels / OCR text | AES-256-GCM with per-file content key | Travels with the photo. |
| Cluster definitions ("face cluster 7 is named 'Anna'") | AES-256-GCM with master key | Library-level metadata. |
| Local HNSW search index (when persisted) | AES-256-GCM with master key | Library-level. |
| Album definitions | AES-256-GCM with master key | Library-level. |

### 4.3 Key recovery

We support **two** recovery mechanisms, both optional and explicit:

1. **Recovery phrase (24 words, BIP39-style):** generated at signup, user must save it. Used to re-derive the master key if the password is lost. We never store it.
2. **Trusted device approval:** if the user has another device already signed in, that device can approve a new device by scanning a QR code over an authenticated channel. The master key is transferred device-to-device, never via the server in plaintext.

We do **not** support email-based password reset that recovers data. Reset only resets the account; data tied to the old master key is unrecoverable. **This must be communicated clearly at signup.**

---

## 5. Mobile Implementation (Android, Primary)

### 5.1 Device coverage target

- **Min SDK:** Android 8.0 (API 26).
- **Min RAM:** 3 GB.
- **NPU/GPU not required** — we have CPU fallback paths, just slower.
- Expected coverage: ~95% of active Android devices in our target markets.

### 5.2 Framework stack

| Layer | Library | Purpose |
|---|---|---|
| High-level vision tasks | **ML Kit** | Face detection, OCR, basic image labeling. Free, hardware-optimized, no model bundled. |
| Custom model runtime | **LiteRT** (formerly TensorFlow Lite) | MobileFaceNet, any custom classifiers. |
| Transformer models | **ONNX Runtime Mobile** | MobileCLIP. Best NPU support for ONNX models. |
| Real-time camera ML (future) | **MediaPipe Tasks** | If we ever add live camera features. |

We deliberately use multiple runtimes — each has strengths, and trying to standardize on one would force compromises.

### 5.3 Models bundled in APK

| Model | Format | Size | Purpose |
|---|---|---|---|
| MobileFaceNet (int8) | TFLite | ~5 MB | Face embeddings |
| MobileCLIP-S0 image encoder (int8) | ONNX | ~30 MB | Semantic search (image) |
| MobileCLIP-S0 text encoder (int8) | ONNX | ~15 MB | Semantic search (query) |

Total ML payload: ~50 MB. Acceptable but worth lazy-downloading on first use if APK size is a concern.

### 5.4 Processing pipeline

```kotlin
// Pseudocode
suspend fun processPhoto(photoUri: Uri, contentKey: ByteArray) {
    val bitmap = decodeForML(photoUri)  // downsample to 224x224 for ML

    // Run all ML in parallel
    val (faces, labels, clipVec) = coroutineScope {
        val facesJob = async { runFaceDetectionAndEmbedding(bitmap) }
        val labelsJob = async { runZeroShotLabeling(bitmap) }
        val clipJob = async { runCLIPImageEncoder(bitmap) }
        Triple(facesJob.await(), labelsJob.await(), clipJob.await())
    }

    val sidecar = MLSidecar(faces, labels, clipVec)
    val encryptedSidecar = encrypt(sidecar.serialize(), contentKey)

    uploadQueue.enqueue(photoUri, encryptedSidecar)
}
```

### 5.5 Background processing strategy

- New photos: process immediately if device is unlocked and active.
- Bulk backfill (first install with existing library): schedule via WorkManager, **only when charging and on Wi-Fi**, with thermal throttling checks.
- Show explicit, resumable progress UI: "Indexing 2,341 of 12,000 photos."
- Persist state so a force-close or reboot resumes from where we left off.

### 5.6 Storage on device

| Data | Storage |
|---|---|
| Decrypted photos (cache) | App private cache, evictable by LRU |
| Encrypted ML sidecars (local copy) | SQLite/Room DB |
| Decrypted CLIP vectors (search cache) | In-memory only, rebuilt per session |
| HNSW index | SQLite as encrypted blob, decrypted on demand |
| Face cluster assignments | Room DB, encrypted column |

---

## 6. Web Implementation

### 6.1 Tech stack

| Layer | Library | Purpose |
|---|---|---|
| ML runtime | **Transformers.js v4** | High-level inference, same MobileCLIP model as mobile. |
| GPU acceleration | **WebGPU** (via ONNX Runtime Web) | 3–10x faster than WASM when available. |
| CPU fallback | **WASM SIMD** (via ONNX Runtime Web) | Universal compatibility. |
| Heavy work isolation | **Web Workers** | Keeps UI responsive. |
| Crypto | **Web Crypto API** + **Argon2 WASM** | AES-GCM and password KDF. |
| Local storage | **IndexedDB** | Model cache, encrypted sidecars, search index. |
| Face detection | **MediaPipe Web** or **BlazeFace via TF.js** | Bounding box detection. |

### 6.2 Browser coverage

- **WebGPU available** (Chrome, Edge, recent Safari, Firefox with flag): ~90% of desktop users, ~70% of mobile web users.
- **WASM-only fallback:** universal.

### 6.3 Processing flow

```javascript
// Pseudocode in a Web Worker
import { pipeline } from '@huggingface/transformers';

const clip = await pipeline('feature-extraction',
    'mobileclip-s0', { device: hasWebGPU ? 'webgpu' : 'wasm' });

async function processPhoto(file, contentKey) {
    const imageBitmap = await createImageBitmap(file);
    const downsampled = downsampleTo224(imageBitmap);

    const [faces, clipVec] = await Promise.all([
        detectFaces(downsampled),
        clip(downsampled)
    ]);

    const sidecar = serializeSidecar({ faces, clipVec });
    const encryptedSidecar = await encryptAESGCM(sidecar, contentKey);
    const encryptedPhoto  = await encryptAESGCM(file, contentKey);

    await uploadBoth(encryptedPhoto, encryptedSidecar);
}
```

### 6.4 The trust problem (and what we do about it)

**Reality:** every web page load re-downloads our JavaScript. A server compromise — or a rogue insider — could ship malicious JS that steals the user's master key on the next login. This is a structural property of the web, not a bug we can fix.

**Mitigations we will implement:**

1. **Subresource Integrity (SRI)** on all script and stylesheet tags. Bundled JS files have their hashes pinned in the HTML.
2. **Strict Content Security Policy:** no inline scripts, no `unsafe-eval`, scripts only from our own origin, no third-party scripts at all.
3. **Open source the web client.** Publish the exact source corresponding to each release.
4. **Code transparency log** (Phase 2): publish hashes of every deployed web bundle to an append-only public log. Security researchers can detect targeted attacks.
5. **Honest threat model on security page:** we document this weakness rather than hiding it. Users who care more should use the mobile apps.

**Mitigations we will not pretend to provide:**

- "End-to-end encryption guarantees you don't have to trust us." — On the web, this is not fully true. We will say so plainly.

### 6.5 Tiered ML on web

Not every browser has WebGPU + enough memory to comfortably run MobileCLIP. We tier:

| Tier | Detection | Strategy |
|---|---|---|
| **A. Capable** | WebGPU available, GPU has ≥4 GB | Run all ML on upload, same as mobile. |
| **B. Limited** | WASM only, or low memory | Run face detection (cheap), defer CLIP indexing. Upload encrypted photo with `ml_pending` flag. |
| **C. Deferred** | User explicitly opts out, or page closed mid-upload | Upload encrypted photo only. ML happens on next mobile sync. |

The "mobile picks up the slack" pattern is important: the user's phone becomes the ML worker for photos uploaded via web on a weak device. The phone downloads the encrypted photo, decrypts locally, runs ML, re-encrypts the sidecar, syncs it back.

### 6.6 Model caching

- First visit: download MobileCLIP files from our CDN (~45 MB), cache in IndexedDB.
- Subsequent visits: load from IndexedDB, no network.
- Version the cache key so model updates invalidate cleanly.
- Lazy-load: don't fetch model until user actually triggers upload or search.

---

## 7. Cross-Device Sync

### 7.1 Sync model

The server is a dumb encrypted blob store with three indices:

- File index: per user, list of `{file_id, ciphertext_pointer, updated_at, version}`.
- Sidecar index: per file, list of `{sidecar_type, ciphertext_pointer, updated_at}`.
- Library metadata index: per user, encrypted library-level state (cluster names, albums, etc.).

Devices pull deltas based on `updated_at`. Conflicts use last-write-wins on the device level, with merge logic for additive structures (face clusters, labels).

### 7.2 Clustering consistency across devices

If two devices independently cluster faces, they may produce different groupings. Solutions:

1. **Leader device:** the first device installed becomes the clustering authority. Other devices fetch its cluster assignments rather than recomputing.
2. **Append-only cluster log:** clustering decisions are recorded as an encrypted log; devices replay the log to reach the same state.
3. (Chosen for v2) **Hybrid:** new embeddings are clustered locally and assigned to existing clusters via nearest-neighbor; only re-clustering of the whole library requires leader coordination, and is rare.

### 7.3 Multi-device onboarding

When a user signs in on a new device:

1. New device: user enters password → derives account key.
2. New device fetches wrapped master key from server, unwraps with account key.
3. New device fetches user's file index and starts pulling encrypted blobs.
4. ML sidecars travel with the photos — new device gets them for free, no re-processing.
5. New device builds its local search index from the decrypted sidecars.

For QR-based device pairing (when password isn't desired), the existing device displays a QR code carrying an ephemeral key; the new device scans it and they perform a Noise-protocol handshake to transfer the master key.

---

## 8. Search Infrastructure

### 8.1 Query types

- **Keyword search** ("dog"): matches against encrypted labels and OCR text after decryption.
- **Semantic search** ("dog at sunset"): CLIP text embedding compared against image embeddings.
- **Face search** ("photos of Anna"): retrieves cluster id, returns photos containing that cluster.
- **Date/location filters**: structured metadata, encrypted but indexed by client.

### 8.2 Search flow (semantic, the most complex)

```
1. User types query in client UI
2. Client encodes query → MobileCLIP text encoder → 512-dim vector  (~5-15 ms)
3. Client checks in-memory cache for decrypted image vectors
4. If cache miss: fetch encrypted vectors batch from server, decrypt
5. Run cosine similarity (or HNSW lookup) → ranked photo IDs
6. Fetch encrypted thumbnails for top results, decrypt, display
```

Query never leaves the device. Server sees only ciphertext blob fetches.

### 8.3 Performance targets

| Library size | Target search latency |
|---|---|
| < 5,000 photos | < 200 ms (brute force) |
| 5k – 50k | < 500 ms (in-memory HNSW) |
| 50k – 500k | < 1 s (persistent HNSW, lazy decrypt) |

---

## 9. Threat Model

### What we protect against

- Server breach / database dump: attacker gets only ciphertext.
- Malicious server operator: cannot decrypt user data.
- Network interception: TLS plus ciphertext payloads.
- Subpoena / lawful access requests: we can hand over ciphertext, nothing more.
- Loss of single device: data on other devices and server unaffected; lost device's local cache is encrypted at rest.

### What we do NOT protect against

- **User's own device compromise:** if the user's phone is rooted by malware, or their browser has a malicious extension, that malware can read everything the user can read. No E2EE system protects against this.
- **Weak passwords + no recovery phrase:** brute-force on a stolen wrapped key file is possible if the password is weak. We enforce a minimum entropy and recommend the recovery phrase.
- **Targeted malicious JS push on web:** until code transparency is shipped, a determined attacker controlling our infrastructure could push targeted JS. Documented on the security page.
- **Metadata side channels:** the server sees file sizes, upload times, access patterns, and IP. Mitigations (size padding, batched fetches) reduce but don't eliminate this leakage. Same as every E2EE system.

---

## 10. Phased Rollout

### Phase 1 — MVP (target: 3 months)

- Android client, web client (capable tier only).
- Face detection + clustering (no naming UI yet, just "Person 1, Person 2").
- CLIP-based semantic search.
- Basic encrypted upload / download / sync.
- Password + recovery phrase auth, no QR pairing yet.

Success metric: can a user upload 500 photos, find "dog at beach" with one search, and verify the server never decrypted anything.

### Phase 2 — Polish (target: +3 months)

- Face cluster naming + merge/split UI.
- OCR.
- Albums + manual organization.
- QR device pairing.
- Web client: WASM fallback tier.
- Code transparency log for web.

### Phase 3 — Advanced (target: +6 months)

- iOS client (uses MobileCLIP variant Apple ships natively).
- Memories / auto-generated highlights.
- Shared albums with E2EE group keys.
- Map view.
- Bulk export tools.

---

## 11. Testing & Validation

### ML accuracy benchmarks

- **Face recognition:** measured on LFW + a private hand-labeled set. Target: >95% precision at >85% recall.
- **Semantic search:** measured against a hand-labeled query set (100 queries, 10k-photo library). Target: relevant photo in top 5 for >80% of queries.

### E2EE invariant tests

- Automated test suite that runs against the server, attempting to decrypt blobs without the user key. Must always fail.
- Network traffic analysis: assert that no request body contains plaintext content. Run on every CI build.
- Logging audit: assert that no server-side log line includes user content.

### Performance benchmarks

- Per-photo ML latency, p50 and p95, on a defined matrix of devices.
- Cold-start library indexing throughput.
- Search latency at 5k, 50k, 500k photo libraries.
- Memory footprint during indexing.

---

## 12. Open Questions / Decisions Needed

1. **Model variant:** MobileCLIP-S0 vs MobileCLIP-S1. S1 is more accurate, ~2x slower. S0 is the safer choice for v2; S1 could be a "high accuracy mode" toggle later.
2. **Cluster leader election:** explicit user-designated "main device", or last-write-wins on the cluster log? Lean toward log-based for simplicity.
3. **Web tier B behavior:** do we run CLIP slowly in WASM, or skip and defer to mobile? Lean toward skip — slow CLIP in a browser tab is a worse UX than honest "indexed on your phone."
4. **Recovery phrase UX:** require display + confirmation at signup, or make it opt-in? Strong recommendation: require, even though some users will skip past it.
5. **OCR languages:** ship English only at v2, or include the ML Kit multi-language pack (+20 MB)? Decision needed based on user geography.

---

## 13. Appendix — Library Versions (as of writing)

| Library | Min version | Notes |
|---|---|---|
| ML Kit (Android) | 18.x | On-device APIs only. |
| LiteRT (Android) | Latest 1.x | Successor to TensorFlow Lite. |
| ONNX Runtime Mobile | 1.18+ | NNAPI delegate, GPU delegate. |
| Transformers.js | 4.x | WebGPU support via ONNX Runtime Web. |
| ONNX Runtime Web | 1.18+ | Used under the hood by Transformers.js. |

---

*End of document. Next step: walk through this with the team, fill in the open questions in section 12, and break Phase 1 into ticketed work.*
