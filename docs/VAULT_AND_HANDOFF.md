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

## Recovery

Vault recovery and password changes belong to Accounts. Products must link to
Accounts rather than implement local vault setup, recovery, or PBKDF2 formats.
After lock/logout, product key stores and decrypted caches are cleared.
