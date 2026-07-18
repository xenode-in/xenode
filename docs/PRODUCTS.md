# Product boundaries

## Accounts

Accounts owns sign-up/login, email verification, OAuth linking, security
activity, profile management, organizations/usage summaries, OIDC authorization,
Vault v2, and key handoff. It does not process file bytes.

## Drive

Drive owns file/folder metadata, direct sharing, organization/team storage,
subscriptions, refunds, support, admin, realtime, and the Office editor parent
shell. User account/security settings link back to Accounts. Drive never mints
user identity sessions and never sees the ARK.

## Photos

Photos is an independent OIDC product and projection over Space-owned encrypted
objects. It uses `@xenode/photos`, its own ProductSession, and its own key-access
gate. It must not import Drive components, contexts, models, or routes.

## Office editor

The editor parent route is `/office-editor` in Drive. The runtime assets are
served from the static-only `edit.xenode.in` origin. The retired
`sheets-v2.xenode.in` host and `/sheets-v2` route tree do not exist.
