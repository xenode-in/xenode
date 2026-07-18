# CLAUDE.md

Use [AGENTS.md](AGENTS.md) as the authoritative repository guide.

Key facts:

- Applications are `apps/accounts`, `apps/drive`, and `apps/photos`.
- Accounts is the sole Better Auth/OIDC authority and Vault v2 owner.
- Drive and Photos authenticate with product-bound ProductSessions and receive
  product/space keys only through one-time key handoff.
- Authorization is Space-scoped; storage keys are opaque; servers see only
  ciphertext; billing reads byte counters only.
- Realtime tickets are mandatory and signed with an independent secret.
- `edit.` and `preview.` are static-only file runtime origins.

Run `npm run typecheck`, `npm run test`, and `npm run check:boundaries` after
non-trivial changes. Drive-scoped work lives in `apps/drive` (`@xenode/drive`).
