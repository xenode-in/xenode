# Xenode Sheets v1 implementation note

The spreadsheet editor reuses Xenode storage objects. All workbook parsing,
generation, encryption, and decryption remains browser-only.

## Audit summary

- Object metadata returns encrypted DEK/name/type, IV, chunk, and workspace wrapping metadata.
- XLS, XLSX, and CSV already map to the `excel` media category.
- Personal and organization lists have separate APIs; shared object APIs accept workspace scope headers.
- Object filters isolate personal, organization, and team ownership.
- Personal keys use RSA/metadata keys; organization objects use the space key.
- Direct shares use separate recipient authorization and key unwrapping.
- Existing version helpers cap history at ten ciphertext versions.
- Per-user Dexie was schema v2 before spreadsheet recovery.
- `proxy.ts` supplies the existing Docs host-rewrite pattern.
- Tests use Vitest, NextRequest route calls, MongoDB Memory Server, and security assertions.

## Reuse and migration

The implementation reuses CryptoContext, WorkspaceContext, object APIs, encrypted
upload, version history, shadcn UI, and per-user Dexie. It adds an additive
`StorageObject.revision` field (missing means zero) and Dexie schema v3. No
plaintext workbook or filename migration is required.
