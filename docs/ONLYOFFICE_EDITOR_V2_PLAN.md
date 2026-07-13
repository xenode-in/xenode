# Xenode Sheets v2: ONLYOFFICE migration plan

## Outcome

Add a self-hosted, Xenode-controlled ONLYOFFICE spreadsheet editor as **Sheets v2** while keeping the current Univer editor fully operational as **Sheets v1**. V1 remains the default until v2 passes security, fidelity, reliability, and rollout gates. Removing Univer is a separate future project and is explicitly out of scope for this plan.

The editor remains inside a borderless iframe. Plaintext workbook data is decrypted, converted, edited, and re-encrypted in the browser. Xenode storage and realtime services must receive ciphertext only.

## Current Xenode baseline

The existing implementation already provides several layers that v2 should reuse:

- `app/(sheets)/sheets/editor/page.tsx` resolves personal, organization, team, and direct-share access.
- `lib/spreadsheets/persistence.ts` and `sharePersistence.ts` unwrap the file DEK in the browser, download ciphertext, enforce revisions, encrypt saves, and use the existing object update APIs.
- `app/api/objects/[id]/update-content/route.ts` creates ciphertext versions and rejects stale revisions.
- `components/sheets/SpreadsheetEditor.tsx` owns the Xenode header, save state, comments, conflicts, recovery, versions, and export UI around Univer.
- Spreadsheet drafts are encrypted in IndexedDB.
- Realtime collaboration is not implemented yet; `NoopSpreadsheetCollaborationAdapter` is intentionally a placeholder.

V1 currently converts XLS/XLSX/CSV into Xenode's normalized workbook model and exports a new XLSX on save. V2 must not pass through that model. It should round-trip the decrypted workbook bytes through the ONLYOFFICE/x2t format pipeline so advanced Excel content is not discarded merely because Xenode's normalized schema cannot represent it.

## Non-negotiable constraints

1. V1 stays available at every v2 rollout stage.
2. No server route, log, queue, database field, analytics event, crash report, or websocket payload may receive plaintext workbook content, filenames, cell values, or editor change data.
3. Storage object keys remain opaque. V2 reuses the existing `StorageObject`, DEK, IV, revision, version-history, workspace, quota, and direct-share rules.
4. Billing code must not import or inspect editor, object crypto, or file metadata.
5. Read-only is enforced in three places: editor configuration, the parent bridge, and the existing server authorization layer.
6. Editor assets are pinned and self-hosted. Runtime requests to ONLYOFFICE, CryptPad, public CDNs, telemetry endpoints, plugin galleries, or remote fonts are prohibited.
7. The iframe boundary stays. Removing it is not a v2 goal.
8. A workbook saved by v2 must still open in v1. A workbook saved by v1 must still open in v2.

## Important technical correction to validate first

The CryptPad fork is not a drop-in stock `DocsAPI` deployment. Its wrapper emulates the ONLYOFFICE server protocol, opens an `Editor.bin`, and exchanges editor commands with a mock server. Normal XLSX import/export also depends on the x2t conversion layer. Therefore, passing an XLSX Blob URL to the stock `document.url` configuration is not sufficient evidence that the browser-only, E2EE design works.

The first spike must prove this exact loop before the application is restructured:

```text
encrypted XLSX in B2
  -> browser decrypt
  -> x2t WASM converts XLSX to Editor.bin
  -> Xenode bridge transfers Editor.bin to iframe
  -> user edits
  -> bridge receives ONLYOFFICE save/change output
  -> x2t WASM exports XLSX
  -> browser encrypt
  -> existing revisioned object update API
```

No v2 production work should proceed until this loop succeeds without plaintext network traffic.

## Target repository shape

Keep the existing Next.js project layout. Do not turn the whole repository into a new monorepo merely to add the editor.

```text
vendor/
  cryptpad-onlyoffice-editor/       # pinned source, preferably a squashed subtree
  XENODE_UPSTREAM.md                # upstream tags/commits, license, Xenode patch level

tools/onlyoffice/
  build-editor.ps1                  # Windows developer entry point
  verify-dist.mjs                   # manifest, hashes, forbidden-network checks

lib/spreadsheets/v2/
  types.ts                          # binary-load/save and bridge contracts
  persistence.ts                    # personal/org/team binary adapter
  sharePersistence.ts               # direct-share binary adapter
  bridge/                           # typed parent <-> iframe protocol
  conversion/                       # x2t worker client and format validation
  recovery.ts                       # separately versioned encrypted v2 drafts

components/sheets/v1/
  UniverSpreadsheetEditor.tsx       # current editor, behavior preserved

components/sheets/v2/
  OnlyOfficeSpreadsheetEditor.tsx
  OnlyOfficeFrame.tsx

public/internal-editors/onlyoffice/
  <immutable-version>/               # generated locally; production artifact, not normal Git history
```

The exact generated path can instead be deployed to `editor.xenode.in`. The source, build scripts, patch records, and reproducibility metadata remain in this repository.

## Delivery phases

### Phase 0 - legal and feasibility gates

Deliverables:

- Pin the exact CryptPad wrapper, `sdkjs`, `web-apps`, x2t WASM, fonts, and dictionaries versions. Do not track an unpinned `main` branch in production.
- Record upstream commit SHAs, source URLs, expected hashes, local patches, and the intended Xenode version such as `oo-9.3.0.140-cryptpad.2-xenode.1`.
- Complete a license/trademark review before distributing a modified build. Preserve applicable AGPL source, notices, build instructions, and source-availability obligations. Verify the exact upstream license text and logo/trademark conditions for the pinned revision rather than relying on a summary.
- Build the editor in a clean container and reproduce the same asset manifest twice.
- Complete the browser-only round-trip spike described above for a blank workbook and a representative XLSX.
- Capture browser network traffic and prove that editor startup, editing, save, and export make no third-party requests.

Exit gate:

- Legal approves the pinned distribution approach.
- The round trip works in Chromium, Firefox, and Safari with no plaintext request.
- The output workbook opens successfully in Excel or LibreOffice and preserves the spike fixtures.

If this phase fails, v1 remains unchanged and the v2 project stops without affecting users.

### Phase 1 - deterministic editor build and hosting

Deliverables:

- Vendor the pinned source with a Git subtree or an equivalent fully reviewable import.
- Keep Xenode changes as small, documented patches on top of upstream.
- Add a separate Docker build for the editor. Do not import ONLYOFFICE source into the Next.js/Turbopack bundle.
- Generate an immutable directory containing `api.js`, `api-orig.js`, editor UI, engines, workers, WASM, fonts, dictionaries, licenses, `version.json`, and an asset hash manifest.
- Add CI cache keys based on upstream commits plus Xenode patch hashes.
- Fail CI if runtime files contain unapproved external origins or if required artifacts are missing.
- Retain at least the current and previous production editor builds so rollback never depends on rebuilding an old fork.

Hosting decision:

- Development may begin at a same-origin path such as `/internal-editors/onlyoffice/<version>/` for easier debugging.
- Production should target `editor.xenode.in` with no Xenode session cookies and a narrow CSP. Plaintext bytes cross the boundary only through a versioned, origin-checked `postMessage` protocol using transferable `ArrayBuffer`s.
- If the CryptPad wrapper's same-origin DOM assumptions cannot be safely removed, that is a security review item, not an excuse to silently ship broad same-origin access.

Exit gate:

- One command builds the pinned editor on CI and on a documented developer environment.
- The deployed assets are immutable, cacheable, integrity-verifiable, and make no third-party requests.

### Phase 2 - add a v2 binary persistence layer

Do not modify the v1 `SpreadsheetPersistenceAdapter` contract. Add a parallel v2 contract with roughly these responsibilities:

- `loadBinary`: reuse current metadata/key unwrapping, baseline protection, ciphertext download, and browser decryption, but return original plaintext bytes instead of `NormalizedWorkbook`.
- `saveBinary`: accept the exported XLSX bytes, encrypt with the existing file DEK and a fresh AES-GCM IV, upload to the current update-content route with `X-Xenode-Base-Revision`, and map HTTP 409 to the existing conflict UX.
- Implement equivalent personal/org/team and direct-share adapters.
- Enforce current file size limits before conversion and add separate limits for decompressed package size, sheet dimensions, embedded media, and conversion memory.
- Zero or release large buffers and revoke object URLs as soon as practical. Never place plaintext workbook bytes in React state, URL query parameters, IndexedDB without encryption, or logs.

The current object routes should need no new plaintext-aware endpoint. Any necessary API change must continue accepting only encrypted bytes and opaque metadata.

Exit gate:

- Unit and integration tests prove personal, org, team, read-only, editor-share, revision-conflict, quota, and version-history behavior using ciphertext-only server assertions.

### Phase 3 - implement the Xenode/ONLYOFFICE bridge

Define a small, typed, versioned protocol rather than exposing arbitrary editor messages:

```text
parent -> frame: INIT, OPEN_EDITOR_BIN, SET_MODE, SET_THEME, REQUEST_SAVE,
                 REQUEST_EXPORT, FOCUS, DESTROY
frame  -> parent: READY, DIRTY_CHANGED, SAVE_BYTES, EXPORT_BYTES,
                 SELECTION_CHANGED, ERROR, DESTROYED
```

Bridge requirements:

- Validate `event.origin`, `event.source`, protocol version, session nonce, message type, and payload size on every message.
- Transfer binary buffers rather than cloning them.
- Reject save/export messages in read-only mode.
- Disable plugins, macros, external images, remote fonts, external hyperlinks that auto-fetch, telemetry, chat, and any feature that needs a plaintext server.
- Provide deterministic teardown: remove listeners, destroy the editor, terminate x2t workers, revoke URLs, and clear pending requests on navigation.
- Convert ONLYOFFICE dirty/save/error events into the existing Xenode save-state vocabulary.
- Expose only the minimal selection information required for Xenode comments: sheet identifier/name and A1 range.
- Sanitize bridge errors before logging. File names, formulas, values, and binary fragments must not enter analytics or error reporting.

Start with single-user editing. Do not route raw ONLYOFFICE change events over the existing Socket.IO service and do not label the first v2 release as realtime collaborative.

Exit gate:

- Editing, Ctrl/Cmd+S, explicit Save, read-only, teardown, crash recovery, and repeated open/close cycles pass without memory growth or plaintext network activity.

### Phase 4 - integrate v2 beside v1

Keep `/sheets/editor` as the stable entry point and add an engine resolver inside the existing page.

Rollout controls:

- `v1` remains the default.
- A server-controlled feature flag or allowlist enables `v2`; a development-only query override may help local testing.
- The chosen engine is recorded only as non-sensitive operational metadata.
- A visible "Open in current editor" action returns the same object to v1 without copying or migrating it.
- A v2 startup/conversion failure offers v1 fallback. It must not automatically fall back after unsaved v2 edits unless it first offers an encrypted recovery/export path.

Reuse the current Xenode shell for back navigation, encrypted/saved status, sharing, versions, conflicts, comments, and workspace labels. ONLYOFFICE owns the spreadsheet canvas, formula bar, sheet tabs, and formatting UI inside the iframe.

Keep the current Univer component behavior intact, moving it to a `v1` directory only when the move can be mechanical and independently reviewed.

Exit gate:

- The same personal, organization, team, and direct-share links open in both engines.
- Switching engines does not create a new `StorageObject`, rotate the DEK, reveal metadata, or lose version history.

### Phase 5 - reach v1 feature parity

Implement and verify these features before broad rollout:

- Read-only viewer and direct-share editor permissions.
- Save states: saved, dirty, saving, offline, failed, conflict, read-only.
- Conflict dialog: reload latest, download local result, or save a copy.
- Original baseline and ciphertext version history restore.
- XLSX download/export and "save a copy". Add CSV, TSV, XLS, and ODS only when x2t output passes fidelity tests.
- Xenode comments panel. File-level comments may ship first; cell anchors require a stable bridge selection contract.
- Encrypted local recovery using a new v2 draft schema/store. Store encrypted periodic Editor.bin or exported workbook snapshots, never v1 normalized JSON.
- Offline behavior that clearly distinguishes "local encrypted draft retained" from "saved to Xenode".
- Theme, keyboard, clipboard, focus, fullscreen, zoom, accessibility, and mobile/unsupported-browser messaging.

Compatibility warnings should be driven by a round-trip test corpus. Do not claim that ONLYOFFICE preserves every XLSX feature merely because it can open the file.

Exit gate:

- The parity checklist passes and no v1 capability required by current users disappears when v2 is selected.

### Phase 6 - security and privacy hardening

Required controls:

- Dedicated editor origin in production, no application cookies, restrictive CSP, `frame-ancestors` limited to approved Xenode origins, `object-src 'none'`, and an explicit `connect-src` allowlist.
- Exact-origin `postMessage`; never use `"*"` as the target origin in production.
- Review iframe `sandbox` permissions and grant only those proven necessary.
- Block service workers for the editor origin unless an audited offline design requires one.
- Disable or proxy nothing that would cause plaintext documents or resources to leave the browser.
- Add CI scans for external URLs and a browser test that fails on unexpected hosts.
- Threat-model malicious workbooks, formula links, embedded objects, external images, macros, zip bombs, decompression bombs, clipboard exfiltration, oversized messages, compromised editor assets, and stale iframe sessions.
- Serve immutable assets with hashes and maintain a fast editor-version rollback switch.

Exit gate:

- Security review signs off on the bridge, origin model, build supply chain, CSP, and plaintext-data-flow tests.

### Phase 7 - test matrix and operational readiness

Build a sanitized fixture corpus covering:

- Small and large XLSX, legacy XLS, CSV, formulas, charts, pivot tables, conditional formatting, data validation, named ranges, merged/frozen/hidden areas, images, links, dates, locales, RTL, and protected sheets.
- Files created by current Xenode v1, Excel desktop/web, LibreOffice, Google Sheets export, and ONLYOFFICE.
- Personal, organization, team, owner, viewer, commenter, editor-share, revoked share, expired session, locked vault, and missing key cases.
- Concurrent stale saves, offline/reconnect, refresh during conversion, iframe crash, worker crash, quota exhaustion, B2 failure, and restore while dirty.

Required automation:

- Unit tests for protocol validation, binary persistence, encryption, revisions, and permission firewalls.
- Route integration tests asserting that server-visible bodies remain ciphertext.
- Browser end-to-end tests for open/edit/save/reopen, v1/v2 cross-open, export, conflicts, recovery, and fallback.
- Network tests that allow only Xenode origins.
- Visual tests for iframe sizing, double toolbar behavior, dialogs, dark/light theme, and smaller screens.
- Performance budgets for editor asset size, cold start, conversion time, peak memory, save time, and repeated mount/unmount leaks.

Operational readiness includes build/runbooks, asset retention, health checks, client-side aggregate metrics without document data, alerts for initialization/conversion/save failures, and a one-click flag rollback to v1.

### Phase 8 - staged rollout

Roll out by flag, with an immediate rollback path at every stage:

1. Developers and local fixtures.
2. Internal Xenode accounts.
3. Opt-in beta users; v1 remains one click away.
4. 1% of eligible new spreadsheet opens.
5. 10%, 25%, 50%, then 100% of eligible opens after stable observation windows.
6. Make v2 the default while retaining v1 fallback.

Do not assign v2 to unsupported formats, browsers, oversized files, or workflows that have not passed their gate. Roll back on any confirmed data-loss/corruption issue, plaintext egress, unexplained save failure increase, or material performance regression.

Suggested promotion metrics:

- Successful editor initialization and workbook conversion.
- Successful save and reopen.
- Conflict and recovery rates.
- v2-to-v1 fallback rate.
- Browser crash/out-of-memory rate.
- P50/P95 load, conversion, and save durations.
- Round-trip fixture fidelity failures.

Metrics must contain opaque object/engine/version identifiers only, never filenames or workbook contents.

## Collaboration as a separate v2.x project

Realtime collaboration is not part of the first v2 release because v1 does not currently provide it and the ONLYOFFICE client expects a server/change protocol with participants, locks, and ordered changes.

After single-user v2 is stable:

- Specify an encrypted collaboration envelope, document/session identifiers, participant authentication, replay protection, ordering, acknowledgements, reconnect behavior, compaction, and lock semantics.
- Encrypt change payloads in the browser before websocket transmission. The server may coordinate opaque envelopes but must not see workbook changes.
- Decide whether the existing file DEK or a separately derived session key protects collaboration messages.
- Test two-user editing, disconnect/reconnect, duplicated/out-of-order messages, stale sessions, role changes, revoked access, and final snapshot persistence.
- Keep collaboration behind a separate feature flag until corruption and replay tests pass.

## Retirement criteria for v1

Making v2 the default does **not** authorize removing v1. Propose a separate removal project only after all of the following are true:

- V2 has been the default for a sustained period with no unresolved data-loss or privacy incident.
- All supported workspaces, shares, browsers, formats, recovery, versions, and exports meet their service targets.
- The fallback rate is low and understood.
- A migration/recovery story exists for every v1 encrypted draft still in IndexedDB.
- Support and operations approve removal.
- Product explicitly approves the removal scope.

Until then, keep the v1 dependencies, code path, tests, and feature flag functional.

## Recommended milestone order

```text
M0  Legal + reproducible build + browser-only round-trip spike
M1  Versioned static editor hosting
M2  Binary E2EE persistence for personal/org/team/direct-share
M3  Typed iframe bridge and single-user save
M4  Parallel v1/v2 UI behind internal flag
M5  Parity: versions, conflict, export, comments, encrypted recovery
M6  Security review + full test corpus + runbooks
M7  Opt-in beta and staged default rollout
M8  Encrypted realtime collaboration (separate v2.x project)
```

The critical path is M0 through M3. Do not schedule broad UI polish or realtime collaboration before the conversion/save loop and license posture are proven.

## Initial implementation slice

The safest first pull request should contain no user-visible editor replacement. It should add only:

1. The pinned upstream/version decision record and legal checklist.
2. The reproducible editor build and asset manifest verification.
3. A development-only lab page that opens a local fixture through the iframe bridge.
4. Network and round-trip tests for that fixture.
5. No changes to the existing `/sheets/editor` selection logic.

That slice provides the evidence needed to authorize the rest of v2 while leaving production v1 untouched.
