# Image Optimization Pipeline (E2EE)

> Redesign of the client-side image variant pipeline for fast, high-quality photo
> viewing under end-to-end encryption. Supersedes the single-WebP approach in
> [lib/images/optimizer.ts](../lib/images/optimizer.ts).
>
> **Status:** design / recommendation. Numbers labelled "indicative" are derived
> from public codec benchmarks, not measured on this repo's hardware — calibrate
> before shipping (see §10).

---

## 0. TL;DR — the decisions

| Question | Decision |
|---|---|
| Best format 2026 | **AVIF** for the optimized variants, **WebP** as the automatic fallback, **JPEG (progressive/mozjpeg)** as the universal last resort. Not JPEG XL (not decodable everywhere until late 2026 — see §3). |
| Variants per image | **4 tiers:** `thumbhash` placeholder (≈25 B, inline) → `thumb` (grid) → `preview` (fullscreen) → `original` (untouched, download/zoom only). Optionally a `full` decodable render for HEIC/RAW zoom. |
| Grid thumbnail | **512 px** longest edge, AVIF, target **12–35 KB** |
| Fullscreen preview | **1600 px** longest edge (mobile-first, fits the ≤250 KB budget), AVIF, target **100–250 KB**. Optional `preview-lg` at 2560 px for desktop. |
| AVIF quality | preview **q58–62** (cqLevel ≈ 28–32), thumb **q48–52** (cqLevel ≈ 36–40) |
| Chroma | **4:2:0** for photos; **4:4:4** for screenshots / text / UI |
| Speed/effort | server `effort 4–6`; browser desktop `speed 5–6`; browser/mobile `speed 7–8` |
| Progressive | N/A for AVIF/WebP (rely on the placeholder→thumb→preview escalation). Progressive **on** for JPEG fallback only. |
| Metrics | Do **not** run per-image Butteraugli/SSIMULACRA2 on device (too costly). Use SSIMULACRA2 **offline** to calibrate the fixed per-content-class presets. |
| Content-aware | Yes — branch on photo / screenshot / document / graphic (§6). |
| Size guard | Encode once at the class preset, then **at most one** re-encode if over the byte budget. |

The single most important consequence of E2EE is in §1 — read it first.

---

## 1. The E2EE constraint that dictates the whole design

In a normal photo service the server holds plaintext and does the clever part:
it stores one master, then transcodes on the fly per request — negotiating format
from the `Accept` header (AVIF to Chrome, WebP to old Safari, JPEG to the long
tail) and resizing to whatever the client asks for (`=s512`, `=w1600`).

**You cannot do any of that.** The server only ever sees ciphertext, so:

1. **No server-side format negotiation.** You can't serve AVIF-or-WebP based on
   the requester. Whatever format you commit to must decode on essentially every
   client, *or* you must pre-generate and encrypt multiple format variants.
2. **No server-side resizing / transcoding.** Every size you'll ever want must be
   produced **on the client before encryption** and uploaded as its own encrypted
   blob. There is no "generate the thumbnail later" — it's now or never.
3. **Encoding happens on the weakest device you support** (a mid-range phone),
   not on a server farm. Encoder CPU cost and battery are first-class constraints,
   not afterthoughts.
4. **Placeholders leak.** A ThumbHash/BlurHash is a blurry render of the plaintext.
   If it's stored unencrypted, the server (and anyone who breaches it) learns the
   rough visual content of every "encrypted" photo. **Encrypt the placeholder too.**

This is exactly the model **Apple iCloud Photos uses under Advanced Data
Protection** (§9): derivatives are generated on-device and every variant is
encrypted. It's the only mainstream analog to your situation, and it validates
the "generate a small fixed pyramid on-device, encrypt each tier" approach below.

---

## 2. The variant pyramid

Generate a **small, fixed** set of tiers. More tiers = better UX granularity but
more on-device encode CPU, battery, and storage. Four is the sweet spot.

```
┌──────────────┬───────────────┬──────────┬─────────────┬──────────────────────────────┐
│ Tier         │ Longest edge  │ Format   │ Target size │ Purpose                        │
├──────────────┼───────────────┼──────────┼─────────────┼──────────────────────────────┤
│ thumbhash    │  (32 px calc) │ 25 B blob│   ~25 bytes │ instant inline placeholder     │
│ thumb        │     512 px    │ AVIF     │  12–35 KB   │ grid / timeline tiles          │
│ preview      │    1600 px    │ AVIF     │ 100–250 KB  │ fullscreen on phone + desktop  │
│ preview-lg*  │    2560 px    │ AVIF     │ 300–600 KB  │ (optional) desktop fullscreen  │
│ full**       │  native res   │ AVIF/JPEG│   varies    │ zoom render for HEIC/RAW only  │
│ original     │  native res   │ untouched│   varies    │ download + zoom (byte-exact)   │
└──────────────┴───────────────┴──────────┴─────────────┴──────────────────────────────┘
* preview-lg: only if you have desktop-heavy users; costs a 3rd encode + storage.
** full: only for sources the browser can't decode natively (HEIC/HEIF/RAW). For
   JPEG/PNG/WebP/AVIF originals, the "original" is already viewable — skip `full`.
```

**Loading ladder (perceived-speed engine):**

1. Grid renders the **thumbhash** immediately (decrypted client-side, no network) → zero-latency, no gray boxes.
2. `thumb` streams in and replaces it (12–35 KB each — a 50-tile screen ≈ 1–1.5 MB).
3. Tap a photo → the already-cached `thumb` is shown upscaled instantly, then `preview` swaps in.
4. User zooms past `preview` resolution, or taps "View original" → fetch + decrypt `original` (or `full` for HEIC/RAW).

Because tiers are **dimension-capped, preview byte size is largely independent of
source megapixels** — a 50 MP DSLR file and a 12 MP phone photo both downscale to
1600 px, so both previews land in the same 100–250 KB band. Source MP mostly
affects *encode time*, not output size.

### Why 512 / 1600

- **512 px thumb:** renders crisp in a ~170–256 CSS-px grid cell at DPR 2–3. Going
  to 256 px saves bytes but looks soft on modern phones; 512 is the honest retina size.
- **1600 px preview:** phones are 1080–1290 px wide (Pixel/iPhone) — 1600 px covers
  them at DPR with margin, and 1600-px AVIF at q60 lands in the ≤250 KB budget for
  almost all photos. 2048 px (your current value) is fine for quality but frequently
  blows past 250 KB on complex images, and phones can't show the extra pixels anyway.
  Keep 2048/2560 as the *optional* `preview-lg` for desktop.

---

## 3. Format recommendation (2026)

**Optimized variants → AVIF. Fallback → WebP. Last resort → progressive JPEG.**

| Format | Decode support (2026) | Compression @ our sizes | Client encode | Verdict |
|---|---|---|---|---|
| **AVIF** | ~94% global; all major browsers by default; iOS 16.4+ / Android 12+ | **Best** at 100–250 KB targets; big win over WebP on photos | WASM (`@jsquash/avif`), CPU-heavy | **Primary** |
| **WebP** | ~98%, effectively universal | Good; ~20–30% larger than AVIF at equal quality | Native `canvas` (Chrome/FF) or WASM | **Fallback** + fast path |
| **JPEG** | 100% | Baseline; progressive helps perceived load | Native everywhere | **Universal floor** |
| **JPEG XL** | Safari default (partial: no progressive/anim); Chrome 145 **behind a flag**; Firefox 152 (Jun 2026) | Excellent, ~ AVIF | WASM | **Not yet** — can't rely on decode, and E2EE forbids server-side negotiation, so a JXL-only variant would be invisible to most users |
| **HEIC** | Apple only | Great | Native on Apple | **Never** as a shared variant (won't decode on web/Android) |

Verified 2026 support:
- AVIF: ~93–95% global; Chrome 85+, Firefox 93+, Safari 16.4+. ([caniuse](https://caniuse.com/avif), [iLoveAVIF](https://iloveavif.com/guides/avif-browser-support))
- JPEG XL: Safari default but partial; **Chrome 145 requires `chrome://flags`**, default expected 2H 2026; Firefox 152 shipped Jun 16 2026. ([caniuse](https://caniuse.com/jpegxl), [PhotoFormatLab](https://www.photoformatlab.com/blog/jpeg-xl-chrome-browser-support-2026))

**Fallback rule (no server negotiation, remember):** the *encoding client* decides.
Encode AVIF; if the target runtime can't decode AVIF (feature-detect once, cache
the result), encode WebP instead and tag the variant's format in metadata so the
viewer knows what it's fetching. In practice ~94% get AVIF, the tail gets WebP.
You may also choose WebP on low-end mobile purely for **encode speed/battery** (§8).

**Revisit JPEG XL in ~Q4 2026** once Chrome ships it unflagged — its lossless JPEG
transcoding (re-compress existing JPEGs ~20% smaller, perfectly reversible) is
attractive for the *original* tier, but it's out of scope until decode is universal.

---

## 4. Exact encoder settings

### 4.1 AVIF (primary) — sharp / libvips option names

```ts
// PREVIEW (fullscreen)
avif({ quality: 60, effort: 5, chromaSubsampling: "4:2:0", bitdepth: 8 })
// THUMB (grid)
avif({ quality: 50, effort: 4, chromaSubsampling: "4:2:0", bitdepth: 8 })
// SCREENSHOT / DOCUMENT / UI (text-bearing)
avif({ quality: 68, effort: 5, chromaSubsampling: "4:4:4", bitdepth: 8 })
// SKY / GRADIENT (banding-prone) — optional
avif({ quality: 62, effort: 6, chromaSubsampling: "4:2:0", bitdepth: 10 })
```

- **quality**: sharp maps 1–100 to libaom CQ internally. 58–62 is the "can't tell
  from original on a phone" band for photos; 68–75 for text where ringing is visible.
- **effort (0–9)**: higher = smaller/slower. Diminishing returns past ~6. Use 4–5
  server-side; the browser uses the `speed` axis instead (below).
- **chromaSubsampling**: `4:2:0` halves chroma resolution — invisible on photos,
  **destroys red/colored text and thin UI lines**. Use `4:4:4` for anything with text.
- **bitdepth**: 8 is the default and fastest. 10-bit meaningfully reduces banding on
  skies/gradients at ~10–15% size and a decode-compat cost — reserve for the gradient class.
- **AVIF has no "progressive"**; don't look for it. Incremental UX comes from the tier ladder.

### 4.2 AVIF (browser, `@jsquash/avif`) — libaom/Squoosh option names

```ts
// PREVIEW
{ cqLevel: 30, cqAlphaLevel: -1, speed: 7, subsample: 1 /*4:2:0*/, sharpness: 0, tune: 0 }
// THUMB
{ cqLevel: 38, speed: 8, subsample: 1 }
// SCREENSHOT / TEXT
{ cqLevel: 24, speed: 6, subsample: 0 /*4:4:4*/, chromaDeltaQ: true }
```

- **cqLevel (0–63, lower = better)** is the browser codec's quality knob — inverse of
  sharp's `quality`. cqLevel≈30 ≈ sharp quality≈60. Preview 28–32, thumb 36–40, text 22–26.
- **speed (0–10, higher = faster)**: on phones use **7–8** — the quality delta vs
  speed 4 is small but the encode-time/battery delta is ~4–8×. Desktop can afford 5–6.
- **subsample**: photos default 4:2:0; switch to 4:4:4 for text (see §6). Confirm the
  exact enum against your installed `@jsquash/avif` version's types.

### 4.3 WebP (fallback)

```ts
// sharp
webp({ quality: 78, effort: 4, smartSubsample: true })          // photo preview
webp({ quality: 82, effort: 4, smartSubsample: true, nearLossless: false }) // thumb
webp({ nearLossless: true, quality: 60, effort: 4 })            // screenshots/UI
```
- `smartSubsample: true` keeps chroma detail near edges (WebP's answer to 4:4:4).
- WebP has **no progressive** mode and gets noticeably worse than AVIF below ~q70 on
  photos, so keep quality ≥ 74 for the preview tier.

### 4.4 JPEG (universal last resort)

```ts
jpeg({
  quality: 80, progressive: true, mozjpeg: true,
  chromaSubsampling: "4:2:0",         // "4:4:4" for text
  trellisQuantisation: true, overshootDeringing: true, optimiseScans: true,
})
```
- **progressive: true** is the one place progressive matters — the image resolves
  low→high detail as bytes arrive, improving perceived speed on slow links.

---

## 5. Dimensions & file-size targets

### Dimensions

| Surface | Longest edge | Rationale |
|---|---|---|
| Grid / timeline tile | **512 px** | crisp at DPR 2–3 in a ~200 px cell |
| Fullscreen — phone | **1600 px** | covers 1080–1290 px devices w/ headroom, fits ≤250 KB |
| Fullscreen — tablet/desktop | **2048–2560 px** (`preview-lg`, optional) | uses the extra screen real estate |
| Zoom / 1:1 / pixel-peep | **original** (or `full` render) | only tier that must be native res |

### File-size targets (preview tier, after encode)

| Source | Typical preview KB (AVIF q60 @1600px) |
|---|---|
| Small photo (≤2 MP, screenshots, social) | 40–120 KB |
| Medium (12 MP phone) | 120–230 KB |
| Large DSLR (24–50 MP) | 200–350 KB (dimension-capped, so not proportional to MP) |
| Screenshot / document (4:4:4, higher q) | 60–200 KB (text needs the bits) |

Budget guard: `PREVIEW_MAX = 250 KB`, `THUMB_MAX = 40 KB`. Encode at the class
preset; if over budget, do **one** re-encode dropping quality by ~8 (or cqLevel +6),
floored at q50 (never below — better to exceed the budget slightly than ship mush).
Don't binary-search per image on device — that's metric-guided tuning's job (§7),
done offline.

---

## 6. Content classification & the decision tree

Different content wants different settings — a JPEG-style quality that's invisible
on a beach photo turns red UI text into a smeared mess. Classify cheaply on-device
(all from the decoded bitmap + filename, no ML needed):

**Signals** (compute on a downscaled 64–128 px version, fast):
- **EXIF present + camera make/model** → real photo.
- **Edge density** (Sobel/Laplacian variance): high + structured → screenshot/document; high + organic → detailed photo.
- **Unique-color count / histogram peakiness**: low colors + large flat regions → UI/graphic/screenshot.
- **Dimensions match a known screen** (e.g. 1170×2532, 1290×2796, 2732×2048) & no EXIF → screenshot.
- **Aspect + face detection** (optional, `FaceDetector` API or a tiny WASM model): faces present → protect quality.
- **Gradient/banding risk**: large smooth regions with low local variance but a wide value range → sky/gradient.

**Decision tree:**

```
decode → downscaled stats
│
├─ no EXIF AND (screen-matching dims OR low-color+high-edge) ─► SCREENSHOT/DOC
│     └─ AVIF 4:4:4, q68–75 (cqLevel 22–26); consider near-lossless WebP if <32 colors
│
├─ low unique colors AND large flat areas (logos, UI, diagrams) ─► GRAPHIC/UI
│     └─ AVIF 4:4:4 q70, or lossless WebP/PNG if tiny palette; keep alpha
│
├─ EXIF camera OR photographic texture ─► PHOTO
│     ├─ face detected ────────────► q +4 over base (don't smear faces)
│     ├─ large smooth gradient ────► bitdepth 10, effort +1 (kill banding)
│     ├─ high ISO / heavy noise ───► light pre-denoise, then q base (noise eats bits)
│     └─ otherwise ────────────────► AVIF 4:2:0 q58–62 (cqLevel 28–32)
│
└─ can't classify ─► PHOTO defaults (safe)

then: if bytes > budget → 1 re-encode (q−8) ; if AVIF-decode unsupported on target → WebP equivalent
```

**Yes, use different strategies for photos vs screenshots vs documents vs UI.** This
is the highest-leverage quality decision in the whole pipeline — 4:2:0 at low
bitrate is great for photos and unacceptable for text. It's a per-image branch,
not a global setting.

---

## 7. Perceptual metrics — use them, but offline

- **PSNR**: don't use for decisions — poor perceptual correlation.
- **SSIM / DSSIM**: okay, dated.
- **VMAF**: video-oriented (Netflix); overkill and not tuned for stills.
- **Butteraugli**: good perceptual distance (from Google/libjxl).
- **SSIMULACRA2**: **best** modern still-image metric (libjxl); scale where ~90 = visually
  lossless, ~70–85 = high quality, <50 = obvious artifacts. Prefer this.

**Should you drive encoding by a metric instead of fixed quality?** Conceptually yes
— target "SSIMULACRA2 ≥ 80" beats "quality = 60" because it spends bits where the
image needs them. **But** a metric-guided search means: encode → decode → score →
adjust → repeat, several times per image. On a phone, before encryption, for every
tier, that's a battery and latency non-starter.

**Recommended compromise (what actually ships):**
1. **Offline**, build a calibration harness (sharp/libvips + `ssimulacra2`) over a
   corpus of ~500 representative images spanning each content class.
2. For each class, find the quality/cqLevel that hits your SSIMULACRA2 target at the
   smallest size. That produces the constants in §4.
3. Ship those **fixed, class-conditioned** presets to clients. Clients run **zero**
   metric computation — just the preset + the one-shot byte-budget guard (§5).

You get ~95% of metric-guided quality at ~0% of the per-image cost. Re-run the
calibration when you change target sizes or add a content class.

---

## 8. How the big players do it (and what transfers)

| Service | Preview generation | E2EE? | Transfers to you? |
|---|---|---|---|
| **Google Photos** | Server-side; one master, on-the-fly resize via URL params (`=w1600`, `=s512`), WebP/AVIF by `Accept`. Progressive escalation. | No | Concept only — you can't do server-side transcode |
| **Apple Photos / iCloud (ADP)** | **On-device** derivative generation; with Advanced Data Protection every derivative is **encrypted** before upload. HEIC/JPEG. | Yes (ADP) | **Directly** — this is your model |
| **OneDrive** | Server-side thumbnail service, sizes via API | No | Concept only |
| **Dropbox** | Server-side thumbnail service (JPEG/PNG/WebP), multiple sizes | No | Concept only |
| **Immich** (open source) | **`sharp`-based**, 3 outputs: ThumbHash placeholder + small **WebP** thumbnail + large **preview** (JPEG default 1440 px, or WebP), original kept; zoom loads original | Self-host | **Directly** — closest working template; mirror its tiering |

Immich's exact defaults are a good sanity check on §2/§5: thumbnail WebP, preview
1440 px (they let you drop to 1080/720), quality ~80, ThumbHash for the instant
placeholder, original untouched, zoom → original. ([Immich system settings](https://docs.immich.app/administration/system-settings/), [media processing](https://deepwiki.com/immich-app/immich/3.4-media-processing))

Takeaway: **only Apple-ADP and Immich share your constraint**, and both do exactly
what §2 proposes — a small on-device pyramid + encrypted variants + original for zoom.
Everyone else's cleverness lives server-side and is unavailable to you.

---

## 9. Web pipeline (production)

All heavy work runs in a **Web Worker** (keeps the UI at 60 fps during a bulk
upload). Steps, in order:

```
select file(s)
  └─ Worker:
     1. decode  → createImageBitmap (jpeg/png/webp/avif/gif)
                  HEIC/HEIF → libheif WASM (heic2any today)
                  RAW       → extract embedded JPEG (as you do now)
     2. read EXIF orientation → bake rotation into the pixels
     3. classify content (§6) from a 64–128px downscale
     4. thumbhash from a ~32px downscale (encode ~25 bytes)
     5. downscale to 512 (thumb) and 1600 (preview) — high-quality resample
     6. encode each tier: AVIF via @jsquash/avif (fallback WebP if unsupported/slow)
     7. STRIP EXIF/GPS from the derived variants (privacy); keep original byte-exact
  └─ Main/crypto:
     8. per-variant AES-256-GCM key → wrap with RSA-4096 pubkey (existing workflow)
     9. upload each encrypted blob to B2 under its own opaque object key
    10. record variant metadata (type, format, w, h, bytes, wrapped key) + encrypted thumbhash
```

### 9.1 Decode + high-quality downscale (Browser API)

`createImageBitmap` can decode **and** downscale in one memory-efficient step —
ideal on mobile (never materializes the full-res bitmap on the JS heap twice):

```ts
// worker.ts
async function decodeAndResize(file: File, maxEdge: number): Promise<ImageBitmap> {
  // Peek dimensions cheaply first
  const probe = await createImageBitmap(file);
  const { width, height } = probe;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  if (scale === 1) return probe; // already small enough
  probe.close();

  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  // resizeQuality: "high" → browser uses a good (Lanczos-ish) filter
  return createImageBitmap(file, {
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: "high",
  });
}
```

For best-in-class resampling beyond what the browser offers, run [`pica`](https://github.com/nodeca/pica)
(Lanczos in WASM/WebGL) on the bitmap — worth it for the thumb tier where softness shows.

### 9.2 Encode to AVIF (Squoosh codec via `@jsquash/avif`)

```ts
// worker.ts
import { encode as encodeAvif } from "@jsquash/avif";
import { encode as encodeWebp } from "@jsquash/webp";

let _avifOk: boolean | null = null;
async function canDecodeAvif(): Promise<boolean> {
  if (_avifOk !== null) return _avifOk;
  // 1x1 AVIF; if decode throws, target can't display AVIF
  const bytes = Uint8Array.from(atob(
    "AAAAHGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAA..." // truncated 1x1 sample
  ), c => c.charCodeAt(0));
  try { await createImageBitmap(new Blob([bytes], { type: "image/avif" })); _avifOk = true; }
  catch { _avifOk = false; }
  return _avifOk;
}

function bitmapToImageData(bmp: ImageBitmap): ImageData {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext("2d", { alpha: true })!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

type Cls = "photo" | "screenshot" | "graphic" | "gradient";

async function encodeTier(
  bmp: ImageBitmap, tier: "thumb" | "preview", cls: Cls,
): Promise<{ bytes: ArrayBuffer; format: "avif" | "webp" }> {
  const data = bitmapToImageData(bmp);
  const text = cls === "screenshot" || cls === "graphic";

  if (await canDecodeAvif()) {
    const cqLevel =
      tier === "thumb" ? 38 : text ? 24 : cls === "gradient" ? 30 : 30;
    const bytes = await encodeAvif(data, {
      cqLevel,
      speed: tier === "thumb" ? 8 : 7,   // fast on device; battery-friendly
      subsample: text ? 0 /*4:4:4*/ : 1 /*4:2:0*/,
      chromaDeltaQ: text,
    });
    return { bytes, format: "avif" };
  }

  // Fallback: WebP (universal decode, faster encode)
  const quality = tier === "thumb" ? 82 : text ? 88 : 78;
  const bytes = await encodeWebp(data, { quality, method: 4 });
  return { bytes, format: "webp" };
}
```

Load the WASM once per worker; reuse across the whole upload batch. Spawn one
worker per hardware thread (`navigator.hardwareConcurrency`, capped ~4) and shard
files across them for bulk uploads.

### 9.3 Instant placeholder (ThumbHash)

```ts
import { rgbaToThumbHash } from "thumbhash";

async function makeThumbHash(bmp: ImageBitmap): Promise<Uint8Array> {
  const small = await decodeToMaxEdge(bmp, 100); // thumbhash wants ≤100px
  const { data, width, height } = bitmapToImageData(small);
  return rgbaToThumbHash(width, height, data); // ~25 bytes
}
// Viewer side: thumbHashToDataURL(hash) → instant blurred <img src>.
```

**Encrypt the ~25-byte thumbhash** alongside the variants (§1 point 4). It's tiny,
so the cost is negligible and it closes the "server can see blurry versions" leak.
Store it as an encrypted field on the object doc (not a separate B2 blob — too small).

### 9.4 Zoom → original (or `full` render)

- Source was JPEG/PNG/WebP/AVIF → the untouched **original is directly viewable**;
  on zoom-past-preview, fetch + decrypt it and swap in.
- Source was **HEIC/HEIF/RAW** → the browser can't decode the original for display.
  Generate a `full` tier at upload time: native-resolution AVIF (q~72) or JPEG (q~90)
  for zoom viewing, and keep the byte-exact original **for download only**. This is
  the one place worth the extra encode — otherwise "view original" fails on Apple
  photos.

### 9.5 Storage/metadata shape

Extend the object doc (conceptually) with a variants array so `useThumbnail` and the
preview dialog know what to fetch and how to decode it:

```ts
variants: [
  { tier: "thumb",   key: "users/{uid}/{hex}", format: "avif", w: 512,  h: 384, bytes, wrappedKey },
  { tier: "preview", key: "users/{uid}/{hex}", format: "avif", w: 1600, h: 1200, bytes, wrappedKey },
  // original stays where it is
]
encryptedThumbHash: "enc:..."   // ~25B ciphertext
```

Keep the opaque-key invariant from `CLAUDE.md` — variant keys are independent random
hex, never derived from tier name or filename. The `format` field is what replaces
server-side `Accept` negotiation: the client reads it to pick the right decoder.

---

## 10. Mobile (native app) pipeline

Same tiers, same encryption, but **use platform encoders** instead of WASM — they're
hardware-accelerated and far kinder to battery than libaom-in-WASM.

- **iOS/macOS:** `ImageIO` / `Core Image` to decode + downscale (`CGImageSourceCreateThumbnailAtIndex`
  with `kCGImageSourceThumbnailMaxPixelSize` = tier edge — decodes at target size, low memory).
  Encode: AVIF via `ImageIO` where available, else bundle `libavif`; HEIC is native and
  cheap but **not** a valid shared variant (won't decode on web/Android), so only use
  HEIC for an Apple-only cache, never for the uploaded tier.
- **Android:** `ImageDecoder` with `setTargetSize` to decode at tier size; encode AVIF
  via `libavif`/`MediaCodec` (Android 12+), or WebP natively (fast, battery-cheap).
- **Battery/CPU policy:** AVIF encode is the expensive step. Options in priority order:
  (1) hardware AVIF encoder if the SoC has one; (2) WebP on battery saver / low-end
  devices (tag format accordingly — the viewer already branches on `format`);
  (3) defer non-`thumb` tiers to when charging + Wi-Fi for bulk backfills.
- **RAW/HEIC zoom:** platform decoders handle these natively, so the `full` tier is
  often unnecessary on native — decode the original on device for zoom.

The variant metadata + encryption workflow is identical to web, so a photo uploaded
from the app is fully viewable on the web and vice versa.

---

## 11. Sharp / libvips — the offline calibration harness

Under E2EE, **sharp cannot run server-side on plaintext** — it has no plaintext to
process. Its role here is **offline**: build the calibration corpus that produces the
§4 constants, and as a reference implementation to validate the client output against.

```ts
// scripts/calibrate.ts  (run locally, never in production request path)
import sharp from "sharp";
import { execFileSync } from "node:child_process";

async function encodePreview(input: string, cls: string) {
  const opts =
    cls === "screenshot"
      ? { quality: 68, effort: 5, chromaSubsampling: "4:4:4" as const }
      : { quality: 60, effort: 5, chromaSubsampling: "4:2:0" as const };
  const buf = await sharp(input)
    .rotate()                                   // bake EXIF orientation
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .avif({ ...opts, bitdepth: 8 })
    .toBuffer();
  return buf;
}

// Score each candidate quality with SSIMULACRA2 (build from libjxl), pick the
// smallest that clears the target score per class → those become §4's presets.
function ssimulacra2(orig: string, cand: string): number {
  return Number(execFileSync("ssimulacra2", [orig, cand]).toString().trim());
}
```

libvips is the engine under sharp; use `sharp` unless you need a pipeline sharp
doesn't expose. `dev:worker` (BullMQ) is **not** the place for this — it can't see
plaintext either.

---

## 12. Benchmarks (indicative — calibrate on your corpus)

Encode time for **one 12 MP photo → 1600 px preview**, single thread. Public-benchmark
ranges, not measured here:

| Path | Encode time | Preview size | Notes |
|---|---|---|---|
| AVIF WASM (`@jsquash`) desktop, speed 6 | ~500–1200 ms | ~120–200 KB | best size |
| AVIF WASM mobile, speed 8 | ~1.5–4 s | ~140–220 KB | battery-heavy; parallelize |
| AVIF native (iOS/Android HW) | ~80–250 ms | ~130–210 KB | preferred on device |
| WebP native `canvas`/platform | ~60–200 ms | ~160–260 KB | fast fallback |
| Canvas WebP q0.82 (**your current**) | ~50–150 ms | ~200–400 KB @2048 | fastest, largest, softest |
| Progressive JPEG (mozjpeg) | ~150–400 ms | ~220–350 KB | universal floor |

Rule of thumb at equal perceptual quality: **AVIF ≈ 0.7× WebP ≈ 0.5× baseline JPEG**
in bytes. AVIF costs 3–10× the encode CPU of WebP — which is why device tier + the
`speed` knob matter so much.

---

## 13. Trade-off matrix

| Axis | Push for quality | Push for speed/battery | This design's default |
|---|---|---|---|
| **Format** | AVIF q high, 10-bit | WebP/JPEG | AVIF, WebP fallback |
| **Quality (cq)** | cqLevel ↓ (more bits) | cqLevel ↑ | class-tuned, size-guarded |
| **effort/speed** | effort 6–9 / speed 0–4 | speed 8–10 | desktop 5–6, mobile 7–8 |
| **CPU/latency** | slow, best size | fast, larger | worker-parallel, native on mobile |
| **Memory** | full bitmap in heap | decode-at-target-size | `createImageBitmap` resize-on-decode |
| **Battery (mobile)** | WASM libaom | HW encoder / WebP | HW first, WebP on saver |
| **Storage** | more tiers, 10-bit | fewer tiers, 8-bit | 4 tiers, 8-bit default |
| **Bandwidth** | 2560 previews | 1600 previews | 1600 mobile-first |
| **Privacy** | encrypt everything incl. placeholder | plaintext thumbhash (leaks) | encrypt thumbhash too |

**The central tension:** AVIF gives you the best size/quality (protecting the
≤250 KB budget and bandwidth) but is the most expensive to encode on the exact
device you're forced to encode on (mobile, pre-encryption). The design resolves it
by: capping dimensions (less to encode), using high `speed`/`effort` on device,
preferring native/HW encoders on mobile, parallelizing across workers, and falling
back to WebP when AVIF encode would be too slow — while never compromising the
untouched original.

---

## 14. Migration from the current `optimizer.ts`

Your [lib/images/optimizer.ts](../lib/images/optimizer.ts) today: single WebP preview
at 2048 px via `OffscreenCanvas.convertToBlob`, quality 0.82/0.88, + original. Gaps
vs this spec and the changes:

1. **Add AVIF** via `@jsquash/avif` with WebP fallback (feature-detected). Biggest
   quality/bandwidth win. (`canvas.convertToBlob("image/webp")` is also unreliable
   on Safari — WASM removes that footgun.)
2. **Add the `thumb` (512 px) tier** — today you only make a preview; the grid needs
   a small tier so a 50-tile screen isn't 50 × 200–400 KB.
3. **Drop preview to 1600 px** (from 2048) to hit the ≤250 KB budget on phones; keep
   2048/2560 as an optional `preview-lg`.
4. **Add ThumbHash placeholder** (encrypted) for instant grid render.
5. **Add content classification** (§6) so screenshots/docs get 4:4:4 + higher quality
   instead of the current photo/graphic quality split.
6. **Move heavy work into a Web Worker** (decode/resize/encode) to keep the UI smooth
   during bulk uploads.
7. **Add the one-shot size-budget guard**; keep the existing "if bigger than original,
   ship original" guard.
8. Keep as-is: HEIC (`heic2any`) and RAW embedded-JPEG paths, the untouched-original
   guarantee, EXIF-strip on derivatives, and the opaque-key invariant.

Sequence: (1) worker + AVIF/WebP for the existing preview → (2) add thumb tier +
thumbhash → (3) content classification + budget guard → (4) optional preview-lg /
`full`-render for HEIC/RAW zoom.

---

### Sources
- [caniuse — AVIF](https://caniuse.com/avif) · [iLoveAVIF 2026 guide](https://iloveavif.com/guides/avif-browser-support)
- [caniuse — JPEG XL](https://caniuse.com/jpegxl) · [PhotoFormatLab — JXL in Chrome 2026](https://www.photoformatlab.com/blog/jpeg-xl-chrome-browser-support-2026)
- [Immich system settings](https://docs.immich.app/administration/system-settings/) · [Immich media processing](https://deepwiki.com/immich-app/immich/3.4-media-processing)
- [jSquash](https://github.com/jamsinclair/jSquash) · [@jsquash/avif](https://www.npmjs.com/package/@jsquash/avif)
