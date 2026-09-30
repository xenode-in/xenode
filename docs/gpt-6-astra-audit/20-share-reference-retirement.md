# Share references during permanent object deletion

Drive Bin cleanup confirms exact B2 deletion before one transaction retires object metadata, quota, and references. That transaction now treats public bundles and album shares as manifests of individual object references.

For a single-file public link, purging its object removes the link. For a bundle, purging one item removes that item, keeps the surviving encrypted item wraps, and moves the canonical `objectId` and bucket to the first survivor. A bundle with one item remains a bundle; a bundle with no items is removed. Download and stream requests without an `itemId` choose the first surviving item. A stale link settings update must pass the link version check, so it cannot restore an item pruned by a concurrent purge. Album-share manifests similarly remove the purged item and remove the link when none remain. Album membership and cover pointers are updated in the same object-retirement transaction.

Public-link creation writes the active Space and all selected live objects in the transaction that inserts the link. If suspension or permanent object deletion wins, creation fails with a conflict rather than persisting an orphan reference. Public reads still require every referenced object and Space to be active; the manifest changes above let a link with surviving items remain usable.

This phase does not change the link's encryption format or rewrap remaining DEKs. It does not create an album-share issuer, replace historical Drive albums with Photos v2, or solve the separate metadata privacy finding for plaintext bundle titles.
