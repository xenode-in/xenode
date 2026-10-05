# Product origin contract

Accounts, Drive and Photos take their web origins from configuration. There is
no assumed production hostname. `@xenode/config` validates exact HTTP(S)
origins: credentials, paths, query strings, fragments and whitespace are
rejected. A root trailing slash is normalized away. Missing production values
throw with the setting name; development/test defaults are localhost ports
3001, 3000 and 3002 respectively.

## Server and browser configuration

Server trust decisions use `ACCOUNTS_ORIGIN`, `DRIVE_ORIGIN` and
`PHOTOS_ORIGIN` through `getServerProductOrigin`. OIDC issuer/callbacks,
same-origin mutation checks, WebAuthn, key-handoff consumption, logout cleanup
URLs and framing headers use the same validated values.

Browser code uses `getPublicProductOrigin` from `@xenode/config/client` with
literal `NEXT_PUBLIC_*_ORIGIN` reads so Next.js can inline them. Configure those
values to match the corresponding server origins. Realtime uses
`NEXT_PUBLIC_REALTIME_ORIGIN` when present, otherwise the configured
`NEXT_PUBLIC_DRIVE_ORIGIN`; Photos CSP and both revocation guards use that same
resolver. `NEXT_PUBLIC_APP_URL` does not authorize requests or determine OIDC
callbacks.

Origins are non-secret build inputs. Next.js freezes its configured headers
and public settings at build time. Compose derives the server and browser
values from one origin per product. Changing an origin requires a rebuild and
matching runtime configuration. Builds continue to need no database or secret.

## First-party OAuth registration

`FIRST_PARTY_CLIENTS` declares web client IDs and products without production
URIs. `resolveFirstPartyClients` resolves each web product to exactly
`${origin}/auth/callback` and `${origin}/` for post-logout. It replaces any
previous web allowlist; a staging deployment does not also trust the old
production host. Native clients retain their explicit custom-scheme URIs.

Accounts registration upserts these complete allowlists on initialization;
the same resolver gates key-handoff destination origins and broker framing.
Drive no longer redirects root-host product pages to a hardcoded second host.
There is no legacy origin compatibility list or database migration.

## Verification

Configuration tests cover missing production values, malformed origins,
normalization and realtime derivation. Identity tests cover exact callback and
logout lists, rejection of unconfigured old callbacks, and unchanged native
URIs. Broker framing rejects the old Drive host when localhost is configured.
Drive proxy tests cover a configured root host and authoritative server origins
when the old public alias disagrees. Live provider, proxy and browser journeys
remain release gates.
