# Confirming physical deletion in versioned B2 buckets

> **Historical phase, superseded for Xenode's R2 target.** The B2-specific
> `ListObjectVersions` cleanup was removed. See
> [22-r2-s3-contract.md](22-r2-s3-contract.md) for the current S3-compatible
> R2 contract. This document records the assumption behind commit `a89cb4e`.

Backblaze B2 buckets are [always versioned](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api-bucket-versions). Its [S3 Delete Object behavior](https://www.backblaze.com/apidocs/s3-delete-object) inserts a delete marker when called without a version ID; older bytes remain stored. The previous key-only `DeleteObjects` call therefore could not prove that Bin, version, or orphan cleanup reclaimed ciphertext.

The shared Drive B2 delete helper now lists versions and delete markers with an exact key prefix, filters strictly to the requested key, and deletes each entry by `VersionId`. It lists again before returning success. Missing version IDs, per-version errors, transport errors, and a key that stays populated after ten bounded sweeps all fail the cleanup attempt. Durable callers keep their manifest and quota state for retry. The single-key helper uses the same contract. The prefix filter never authorizes deletion of a longer sibling key such as `file-thumb`.

Drive version-history cleanup also checks UploadSessions for its physical keys and waits until the latest signed PUT expires. Bin purge already records the latest such expiry; orphan cleanup processes expired ledgers. This prevents a still-live URL from recreating a version after the cleanup record is retired.

This phase does **not** make active reads immune to signed PUT replay. B2 can create a newer version of a committed key while the URL remains valid. The committed version must be pinned in file metadata and all read paths, or the provider must enforce write-once keys. Provider-side conditional `If-None-Match` behavior is not assumed for B2. Active-object physical-version metering and version-pinned reads remain open. No live B2 bucket or deployed cleanup route was exercised; disposable development buckets with historical key-only deletions require a full version-aware reset.
