# Vault v2 and key handoff

## Key hierarchy

```text
Vault password
  └─ Argon2id key
      └─ AES-GCM envelope -> Account Root Key (ARK)
          ├─ Drive ProductSpaceKey
          ├─ Photos ProductSpaceKey
          └─ Drive RSA-OAEP sharing private key
```

The sharing public key is published so collaborators can wrap share/grant keys.
The private key remains subordinate to the ARK and is transferred to Drive only
inside the same destination-bound handoff bundle as the Drive ProductSpaceKey.

## Atomic initialization

`POST /api/vault/bootstrap` is the only Vault creation endpoint. The browser
prepares the password/recovery/device/sharing envelopes and both personal
Drive/Photos product envelopes once, then submits them with a stable
`Idempotency-Key`. A snapshot/majority MongoDB transaction creates the Vault,
personal Space, both product envelopes and sanitized creation event together.
It never replaces an existing Vault or key envelope. Standalone Vault and
Space-product-key PUT endpoints have been removed.

An exact retry returns the original creation receipt. Changing the payload or
operation identity after creation returns 409. Existing revision-checked device,
passkey and password-envelope operations remain separate from initialization.
The server receives only ciphertext envelopes and public context; neither the
Vault password, recovery secret nor ARK is transmitted. See the
[bootstrap API and retry contract](gpt-6-astra-audit/25-vault-bootstrap-contract.md).

## Handoff binding

The Accounts broker and product consumer validate the same binding fields:

- account ID
- product ID and OIDC client ID
- exact destination origin
- Space ID
- transaction ID and expiry
- destination ephemeral public-key fingerprint

The product creates an ephemeral ECDH keypair. Accounts derives a transport key
with HKDF, encrypts the product bundle with AES-GCM and binding AAD, and stores
only the sealed response. Consumption is one-time. Cross-account, cross-product,
wrong-Space, expired, replayed, and destination-mismatch requests fail closed.

Drive's isolated pages cannot retain a cross-origin Accounts opener reference
([browser behavior](https://developer.chrome.com/blog/coop-restrict-properties)).
Interactive unlock therefore opens an ordinary Accounts tab with
`noopener noreferrer`. After the user's click, the originating product tab uses
`@xenode/key-handoff`'s authenticated consume helper to wait for the sealed
handoff. It retries only the existing ambiguous 410 response, once per second
for at most two minutes; other failures stop immediately. The full original
binding is sent on every request. This does not extend a server grant's expiry,
relax its one-time consumption, or persist product or ephemeral keys.

Only one interactive consumer runs per attempt. Automatic iframe completion
still uses its exact-origin message; messages cannot race an active interactive
consumer. Lock, scope changes, retry and unmount cancel waiting. A late response
cannot install a key after cancellation. Accounts tells the user to return to
the product tab after delivery. COOP/COEP, origin/framing rules and the ARK
boundary remain enforced.

## Recovery

Vault recovery and password changes belong to Accounts. Products must link to
Accounts rather than implement local vault setup, recovery, or PBKDF2 formats.
After lock/logout, product key stores and decrypted caches are cleared.

## Browser device trust

An explicitly consented Accounts device wrap expires after 30 days. Its deadline
is bound by the existing envelope AAD. This is separate from login sessions,
trusted second factors and passkeys. See the
[device trust contract](gpt-6-astra-audit/43-vault-device-trust.md).
