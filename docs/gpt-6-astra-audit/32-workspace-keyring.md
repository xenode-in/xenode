# Workspace keyring

This contract closes F18 (and the same-version overwrite noted under F06).
Organization and team Spaces have one random AES-256 Space key per *version*.
Each keyholder holds one RSA-OAEP-wrapped grant per version in
`SpaceProductKey`; together those grants are the member's keyring.

## Grants

- **Create-only.** A pending or active grant for a member and version is never
  replaced, so nobody can substitute a different key under an existing
  version (`409 product_key_grant_exists`). A revoked or retired grant may be
  replaced when the same member is admitted again.
- **Complete.** Every new keyholder receives a grant for every version the
  Space has issued (`grants: [{ keyVersion, wrappedKey }]`); the server
  rejects missing, extra or duplicate versions (`409 key_grants_incomplete`).
  This applies to invitations with keys, deferred-invitation key delivery,
  guest promotion and team membership. Acceptance activates the whole pending
  keyring with the membership in one transaction and refuses an incomplete one.
- **Rotation keeps history.** Removing or demoting a keyholder revokes their
  grants and adds version `n + 1` for every remaining keyholder. Older grants
  stay active: content keeps the `spaceKeyVersion` it was written with. Pending
  invitation grants are revoked and the invitation waits for an admin to grant
  the full keyring again.
- **Serialized.** Every grant-changing operation runs in one transaction that
  first bumps `Space.keyringFenceVersion`, then reads membership and versions
  and validates. Concurrent rotations, invitations and additions conflict and
  retry against fresh state.
- `POST /api/orgs/{orgId}/keys` only distributes an issued version a member
  lacks; new versions come only from rotation.

- Removing a member, or demoting one to guest, also drops their team
  memberships and revokes their grants in every Space of the organization.

## Known limits

- Leaving the organization (removal or demotion) does not rotate the keys of
  the teams the member belonged to; they lose access to the ciphertext, but
  content written later under those team keys would be readable with keys
  they already held. Team rotation needs grants for each affected team.
