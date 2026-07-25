# Local development

Xenode is a Turborepo monorepo of three independently-deployed Next.js apps plus
shared packages. After the identity migration, **Accounts is the OIDC authority**
and Drive/Photos are OIDC clients with their own host-only product sessions — so
running "the app" means running the backing services **and** at least Accounts +
the product you're working on.

## Topology

| App | Workspace | Port | Role |
|---|---|---|---|
| Accounts | `@xenode/accounts` | 3001 | Identity authority: login/signup, OIDC provider, Vault v2 + key-handoff broker, account hub |
| Drive | `@xenode/drive` | 3000 | Main product (files, org, office editor) |
| Photos | `@xenode/photos-web` | 3002 | Photos product |

| Service | Port | Needed for |
|---|---|---|
| MongoDB | 27017 | **Required** — users, sessions, product sessions, vault, storage metadata |
| Redis | 6379 | Realtime tickets/pub-sub. Fail-closed: apps still run and you can log in without it |

Each app reads its own `apps/<app>/.env.local` (git-ignored). They're already set
up for the ports above.

> **Dev origins use plain `localhost` ports**, not `*.localhost` subdomains — Accounts
> `http://localhost:3001`, Drive `:3000`, Photos `:3002` (set via `NEXT_PUBLIC_*_ORIGIN` /
> `ACCOUNTS_ORIGIN` etc.). Subdomain hosts are a production concern only.
>
> **All three apps must point `MONGODB_URI` at the _same_ database.** Accounts
> creates the `user` record on sign-up; Drive/Photos resolve the session by
> reading that same user from their own connection. If the DB names differ,
> login silently fails (the product can't find the just-created user) and you
> get a redirect loop. The apps here all use
> `mongodb://localhost:27017/refactor-xenode`.

## Quick start

You need a MongoDB on :27017. If you don't have one installed, use the bundled
ephemeral one (see below). Then run the apps.

```bash
# terminal 1 — ephemeral MongoDB (data resets on restart; zero install)
npm run dev:mongo

# terminal 2 — all three apps at once (Drive 3000, Accounts 3001, Photos 3002)
npm run dev:all
```

Then open **http://localhost:3000**. Drive redirects to Accounts (`:3001`) to sign
in, and lands you back on Drive's `/dashboard`.

### Prefer separate terminals / just one product

```bash
npm run dev:mongo       # MongoDB :27017 (or your own mongod / docker)
npm run dev:accounts    # :3001  — always needed (it's the login authority)
npm run dev:drive       # :3000
npm run dev:photos      # :3002  (optional)
```

`npm run dev` (no suffix) still starts **Drive only** — handy, but login won't
work unless Accounts is also up.

## The auth flow (why Accounts must run)

1. You hit a protected Drive route (e.g. `/dashboard`).
2. `proxy.ts` sees no `xenode_drive_session` cookie → redirects to `/auth/login`.
3. `/auth/login` starts OIDC Authorization Code + PKCE against Accounts
   (`ACCOUNTS_ORIGIN`, `:3001`).
4. You sign in / sign up on Accounts; it redirects back to
   `/auth/callback`, which verifies the id_token against the Accounts JWKS,
   mints a Drive `ProductSession`, and sets a host-only cookie.
5. Photos works the same way against its own `:3002` callback.

First-party client redirect URIs are derived from `DRIVE_ORIGIN` / `PHOTOS_ORIGIN`
in `apps/accounts/.env.local` (see `resolveFirstPartyClients` in
`@xenode/identity-core`), so localhost callbacks are allowed in dev.

## Persistent database (optional)

`npm run dev:mongo` is **ephemeral** — every restart is a clean slate. For data
that survives restarts, run a real MongoDB instead and skip `dev:mongo`:

- **MongoDB Community** installed as a local service, or
- **Docker**: `docker run -d -p 27017:27017 mongo:7` (and
  `docker run -d -p 6379:6379 redis:7` for realtime).

The apps only care that something answers on `:27017` (and optionally `:6379`);
no app config changes are needed.

## Other useful scripts

```bash
npm run typecheck          # tsc across all workspaces
npm run test               # vitest across all workspaces
npm run check:boundaries   # dependency-direction lint
npm run build              # turbo build all
```
