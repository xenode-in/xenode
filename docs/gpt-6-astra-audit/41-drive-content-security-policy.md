# Enforced Drive Content Security Policy

Drive HTML responses use an enforced nonce policy from `lib/security/csp.ts`.
The proxy creates 32 random bytes for every response, overwrites caller CSP
and nonce headers before SSR, and sends the same policy to the browser. HTML
is private/no-store. The root layout reads request headers, so pages render
dynamically; full HTML cannot be cached with a reused nonce. Navigation retains
the original document's nonce context for later checkout scripts.

Framework scripts receive the nonce from Next's request CSP. Theme bootstrap,
JSON-LD and the Razorpay Script explicitly receive it. Production permits
nonce-authorized scripts and strict-dynamic, with wasm-unsafe-eval for crypto
WebAssembly. It does not permit JavaScript eval, inline event handlers, objects
or framing the application. Development alone allows unsafe-eval for Next's
hot reload. Styles allow inline values used by existing React/Tailwind widgets.
[Next's nonce guidance](https://nextjs.org/docs/app/guides/content-security-policy)
explains dynamic rendering and framework propagation.

Connections allow exact configured Accounts, realtime, R2 endpoints and the
configured PostHog ingestion origin. Workers/media/images use the existing
local/blob/data resources; OAuth avatar and public asset origins are explicit.
Frames allow configured Accounts and static editor/preview runtimes. Checkout
alone also permits checkout.razorpay.com, api.razorpay.com and the telemetry
origin lumberjack.razorpay.com observed by the actual SDK browser probe.
PostHog external dependency loading stays disabled alongside replay/autocapture;
only bundled explicit-event code runs. No host wildcard is added.

The separate nonce-based coordinated-logout document retains its own policy.
API origin/auth guards and the static hostile-runtime policy are unchanged.
The old Office-shell CSP and report-only application header are removed so
conflicting policies cannot disable the cross-origin editor frame. Known
asset directories are excluded from proxy work; dynamic page slugs retain
CSP even when they end in a file-like extension.

`npm run test:browser --workspace @xenode/drive` runs deterministic Chromium
checks with a local HTTP fixture and the production policy. It verifies native
injection/eval blocking, nonce freshness, the bundled PostHog SDK/local receiver
and checkout-only frame permission. The synthetic SDK fixture disables its
user-agent bot filter for automation; the application keeps its existing
filter. `CSP_PROVIDER_SMOKE=1` additionally loads the actual Razorpay SDK and
opens an invalid-key probe that cannot transact. `DRIVE_CSP_SMOKE_URL` enables
the production Next hydration/navigation check against a disposable local app.
Set `PLAYWRIGHT_BROWSER_CHANNEL=chrome` for an installed Windows Chrome; CI
uses Playwright's installed Chromium. Browser artifacts are ignored.

Verified locally: five browser cases with an isolated headless Chrome, actual
Razorpay SDK, installed PostHog SDK and a compiled Drive app using disposable
Mongo/fake runtime credentials. The in-app browser kernel failed on Windows
sandbox ACL setup before navigation; headless tests provided the evidence.
Live authenticated checkout with real test-provider credentials, actual
analytics ingestion, Vault/WebAssembly and renderer journeys remain release
checks. No payment, real-user analytics or external deployment was performed.
