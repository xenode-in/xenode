# Accounts Vault browser trust

Vault browser trust is an explicit opt-in that permits local unlock after a
later authenticated Accounts sign-in. It is separate from Better Auth's login
session, its optional trusted second-factor browser, and passkey/PRF unlock.
Their expiry and revocation rules remain independent.

Browser device wraps now last 30 days from creation. Both bootstrap and
`POST /api/vault/devices` require the shared crypto-core policy: the account,
active device type, initial key version, valid ciphertext/IV, browser algorithm,
UUID and canonical creation/expiry timestamps must agree. The lifetime cannot
exceed 30 days; creation may be at most five minutes ahead of server time to
allow clock skew. Expiry is exclusive. Missing or malformed deadlines are not
accepted as indefinite trust.

The existing AES-GCM v2 envelope still contains exactly the 32-byte ARK. Its
key identity is `ark:device:<UUID>:<expiry Unix milliseconds>`; that complete
identity already participates in crypto-core's authenticated additional data.
Changing either the expiry metadata alone or its key identity cannot extend
an existing wrap. No new encryption primitive or parallel envelope format is
introduced, and neither the ARK nor the device wrapping key reaches the server.

The browser persists only its non-extractable, consented wrapping key and an
account-scoped device pointer. Local restore rechecks the deadline before and
after asynchronous key operations. Expired, revoked, unavailable or corrupt
wraps return to password unlock and discard that local wrapping key. Cleanup
uses the captured device identity, so a newer pointer/key from another tab is
not erased. Failed enrollment cleans its newly generated key and restores an
earlier pointer when safe.

`GET /api/vault` omits ineligible browser wraps and sends private/no-store.
It does not mutate the Vault on read. Enrollment prunes expired browser wraps
in the same revision-checked mutation that adds the new one, so expired entries
do not exhaust the 50-envelope limit. Passkey/PRF envelopes in that same array
are preserved and follow their own credential policy. Protective DELETE stays
available without recent-auth or rate-limit requirements. New enrollment still
requires recent authentication and the existing per-account budget.

No compatibility reader or migration is supplied for disposable development
browser wraps without deadlines: unlock with the unchanged Vault password,
recovery phrase or passkey and consent again. Password, recovery, product and
sharing-key envelopes and existing file keys are not replaced.

This deadline limits future automatic restore; it does not erase an ARK already
unlocked in an active tab or data someone already copied. Lock/logout/session
revocation and the normal memory-key lifecycle still govern active use. The
server cannot remotely erase an offline browser's copied material.

Tests cover real AES-GCM deadline tampering, exact expiry, overlong/future or
foreign wraps, BSON/JSON timestamp round trips, asynchronous expiry, local key
cleanup, failed enrollment, passkey preservation, capacity pruning and unchanged
protective revocation. Hardware/browser persistence and deployed sign-in/revoke
journeys remain release checks owned by the deployment operator.
