# Drive folder model and immutable physical keys

This contract closes F35 and the folder-key part of F08. Physical storage keys
are identities, never locations; the folder tree is metadata.

## Records

- **File keys** are server-issued and immutable: `<spaceRoot><random hex32>`
  plus the existing `-thumb`, `-optimized` and `-chunk-N` derivations and
  revision keys under the same root. `spaceRoot` is `users/<accountId>/`,
  `workspaces/<orgId>/objects/` or the team prefix. Presign ignores any client
  prefix. No route copies or deletes a blob to change where an item appears.
- **Folders** are `application/x-directory` records with no blob. Their `key` is
  an opaque identity, `<spaceRoot><folderObjectId>/`, unique per bucket and never
  written to R2 (storage code already skips keys ending in `/`). A folder
  requires an encrypted display name; there is no plaintext folder name.
- Every Drive record carries `folderId` (parent folder, or `null` for the Space
  root) and `ancestorIds` (root-to-parent chain). Nesting is limited to 32
  levels. Indexes cover `{spaceId, folderId, deletedAt}` listings and
  `{spaceId, ancestorIds}` subtree operations.

## Operations

All structural writes run in one snapshot/majority transaction in
`@xenode/database` (`drive-folders`), resolving the destination inside the same
transaction:

- **Create folder** (`manage`): fences the active Space, validates the live
  parent folder in the same Space, inserts the record and counts it as a
  zero-byte object (owner `totalObjects`, bucket `objectCount`), which purge
  reverses like any other record.
- **Upload completion**: the optional `folderId` must be a live folder in the
  upload's Space; the object is created with that placement.
- **Move** (`manage`): metadata only. Sets `folderId`/`ancestorIds` on the
  selected roots and rewrites descendants' ancestor prefixes; refuses moving a
  folder into itself or a descendant and depth overflow. Sidecars follow their
  file. Version history, chunks and pending signed URLs are untouched.
- **Bin** (`delete`): selected items, all live descendants of selected folders
  and their sidecars receive one shared `deletedAt`. Items binned earlier keep
  their own timestamp.
- **Restore** (metadata only) selects a folder's batch by query: descendants
  with the same `deletedAt` and the selected files' sidecars, with no
  descendant cap (binning has none either). A restored item whose parent is no
  longer live is re-homed under its deepest live ancestor (or the root), and its
  descendants' ancestor chains are rewritten.
- **Purge** captures a per-object deletion manifest, so one explicit
  selection, folder batch included, is capped at 100 objects. Larger binned
  folders are purged by Empty Bin or retention, which page through the Bin in
  batches of 100.
- **Listing** filters by `folderId`; the Redis folder cache is keyed by Space
  and folder, not by user or prefix.

Live folders therefore always have live ancestors: binning removes whole
subtrees, moves require a live destination, and restore re-homes orphans.

## Development data

There is no migration from key-path folders. Reset disposable development
databases and buckets; old folder marker blobs are not referenced by the new
model.
