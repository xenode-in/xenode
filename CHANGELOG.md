# Changelog

All notable changes to Xenode are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
with pre-release identifiers (`-beta.N`, `-rc.N`) during the road to 1.0.

## Release roadmap

| Version          | Milestone                       |
| ---------------- | ------------------------------- |
| `0.1.0-beta.1`   | First public beta (1 July 2026) |
| `0.1.0-beta.2`   | Bug fixes                       |
| `0.2.0-beta.1`   | New features                    |
| `0.9.0-beta.1`   | Feature complete                |
| `1.0.0-rc.1`     | Near-final release candidate    |
| `1.0.0`          | Stable production release       |

---

## [0.1.0-beta.1] — 2026-07-01

🎉 **First public beta.** Xenode is open for public testing. Expect rough
edges — please report issues so we can fix them before 1.0.

### Highlights

- **End-to-end encrypted storage** — files are encrypted in the browser with a
  per-file AES-256-GCM key, wrapped by the user's RSA-4096 public key before
  upload. The server only ever stores ciphertext (file bytes, names, and keys).
- **Direct-to-B2 uploads** — large files upload straight from the browser to
  Backblaze B2 (S3-compatible); the server never touches file bytes.
- **Bucket-based organization** — group files into isolated, encrypted buckets.
- **Secure link sharing** — share any file via a link whose decryption key
  travels in the URL fragment and is never sent to the server.
- **Accounts & auth** — email/password + Google OAuth, with TOTP 2FA and email
  OTP, powered by Better Auth.
- **Subscription billing** — Razorpay-backed plans (basic, pro, plus, max) with
  coupons, campaigns, a 14-day money-back guarantee, and a full audit log.
- **Self-hostable** — run your own instance with your own MongoDB, Redis, and
  storage backend.

### Known limitations

- Public beta: data, pricing, and APIs may change before 1.0.
- Lost passwords cannot recover encrypted data — by design, there is no backdoor.

[0.1.0-beta.1]: https://github.com/xenode-in/xenode/releases/tag/v0.1.0-beta.1
