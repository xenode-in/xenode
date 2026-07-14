# File renderer security boundary

Xenode stores arbitrary bytes but previews only explicitly approved formats.
Every decrypted renderer is disabled by default and requires both a deployment
approval flag and an operational kill-switch state.

## Trust boundaries

- `xenode.in` owns sessions, keys, decryption, encryption, and authenticated
  APIs.
- Verified raster images, user-initiated audio/video, and escaped text render
  with native browser primitives in the trusted app. PDF uses a pinned PDF.js
  worker and canvas only. None of these formats is placed in an iframe.
- `edit.xenode.in` is the static-only Office runtime host. It receives one
  file/session's bytes over a transferred MessagePort.
- Keys, tokens, cookies, user IDs, storage URLs, and unrelated filenames are
  never transferred.
- Unsupported, malformed, mismatched, active, versioned, and deleted content is
  download-only.

## Accepted residual risk

The Office runtime shares the `xenode.in` registrable domain. This is weaker than
placing it on a separate site. Origin isolation prevents direct
DOM and storage access, while host-only cookies, strict runtime CSP, static-only
hosting, CSRF protection, Fetch Metadata checks, and API origin enforcement
reduce same-site request risk. They cannot make the same security claim as a
separate registrable domain.

Encrypted chunked audio/video has a separate, explicitly accepted exception:
the trusted app may register a same-origin service worker to provide native
byte-range playback. The worker temporarily receives one file's raw DEK and
short-lived signed chunk URLs. It exposes plaintext only at a 256-bit random
capability path bound to the registering browser client. It must never persist
plaintext in Cache Storage or IndexedDB, broadcast keys or progress across
clients, accept non-media content types, or serve another client's request.
Implementations must retain the bounded eight-chunk cache, four-session limit,
15-minute idle expiry, two-hour absolute expiry, explicit close message,
credential-free storage fetches, `no-store`, and `nosniff`.

This is weaker than keeping decrypted ranges entirely outside the trusted app
origin. Trusted scripts in the owning tab can use an active capability URL, and
a compromise of the trusted app or worker can expose the active file. Other
same-origin tabs are denied by browser client ID and cannot guess the
capability. Moving media playback into `preview.xenode.in` remains the preferred
long-term isolation upgrade.

This exception is an explicit product decision. Moving the runtimes to a
separate registrable domain remains the recommended defense-in-depth upgrade.

## Emergency response

1. Set the affected runtime kill switch in the super-admin File Security page.
2. Set `SAFE_PREVIEW_GLOBAL_ENABLED=false` for the next deployment.
3. Preserve download-only access.
4. Never restore main-origin file parsing, plaintext upload, key relay, or the
   legacy file-ID-addressable, cross-client, persistent, or unbounded
   service-worker protocol.

## Release gate

A renderer stays disabled until its signature policy, malicious corpus,
resource limits, teardown, CSP, and Chromium/Firefox/WebKit tests all pass.
The Office renderer additionally requires the bridge state machine, E2EE
network canary, SBOM, and provenance gates.

## Preview minimization

File lists, recent files, search results, starred items, shares, versions, and
bin views use format icons. Only photo/gallery and local image-selection
surfaces may request image thumbnails. PDF, text, media, and Office rendering
always requires an explicit user action. HTML, SVG, Markdown, archives,
macro-enabled Office files, executables, malformed files, mismatches, and
unknown formats remain download-only.
