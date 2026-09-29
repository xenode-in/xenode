# Direct Drive revisions

Owner and DirectShare editor saves use JSON control requests at their
`update-content` endpoints. Both require `x-xenode-base-revision`.
Binary request bodies and the old in-place JSON PUT flow are rejected.

1. Send `{ operation: "presign", size, iv }`. Size is ciphertext bytes (16 to
   128 MiB + 16), and IV is a fresh canonical base64 12-byte GCM nonce.
2. The server records a revision-purpose UploadSession bound to actor, Space,
   bucket, target object, base revision, size, IV and optional editor share.
   It returns `uploadUrl` and `sessionId`.
3. PUT encrypted bytes directly to B2 using a storage fetch with omitted
   credentials and no product/Space headers.
4. Send `{ operation: "complete", sessionId }` with the same base revision.
   The server verifies B2 length, then commits revision, retained snapshots,
   owner quota, bucket bytes and manifest completion in one Mongo transaction.

The DEK and wrapped-key metadata stay unchanged; the browser encrypts each
revision with a fresh IV. A unique database claim rejects simultaneous reuse of
one file IV. No filename, cell data, plaintext or raw key is sent
to the control API. The shared upload engine retries uncertain completion once
with the same manifest. Completed retries return the exact committed revision
without another HEAD or quota charge.

Editor authorization is checked again in the transaction. A conditional share
write serializes commit with revocation/role changes. Personal files charge the
owning Space's account; organization/team files charge OrgUsage, including
recipient saves. A stale base revision returns 409 with the latest revision.
Quota/bucket/identity failures abort all database writes and leave ciphertext
reserved for orphan cleanup. Revision reservations cannot be finalized through
the generic create-upload endpoint or refreshed through its variant flow.

The immutable original and nine rolling snapshots remain available. Overflow
snapshots are marked `pendingDeletion`, retained in metadata and charged until
their B2 deletion is confirmed. They cannot be restored or downloaded through
the version routes. A bounded pending-history backlog blocks further saves.
Durable deletion of these snapshots and transactional restore/manual deletion
are the next lifecycle phase. No migration for disposable development records
is included.

This does not solve completed PUT replay, folder-prefix privacy, every legacy
crypto format, or the remaining download byte proxies. No live B2 operation was
used to validate this contract.
