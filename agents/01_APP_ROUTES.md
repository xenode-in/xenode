# App Routes — Full Route Map

This file documents every route in the `app/` directory. Next.js App Router uses folder = URL convention. Route groups like `(auth)` and `(dashboard)` do NOT appear in the URL.

---

## Public / Marketing Routes

| URL | File | Description |
|---|---|---|
| `/` | `app/page.tsx` | Landing/marketing homepage with hero, features, pricing preview |
| `/pricing` | `app/pricing/page.tsx` | Full pricing plans and comparison table |
| `/blog` | `app/blog/page.tsx` | Blog listing page (all MDX posts) |
| `/blog/[slug]` | `app/blog/[slug]/page.tsx` | Individual blog post rendered from MDX |
| `/changelog` | `app/changelog/page.tsx` | Product changelog listing |
| `/changelog/[slug]` | `app/changelog/[slug]/page.tsx` | Individual changelog entry |
| `/shared/[token]` | `app/shared/[token]/page.tsx` | Publicly accessible shared file (no auth required) |

---

## Auth Routes — `app/(auth)/`

Route group — does NOT add `/(auth)/` to URL.

| URL | Description |
|---|---|
| `/login` | Login form (email + password via better-auth) |
| `/register` | New account signup form |
| `/forgot-password` | Password reset request |
| `/reset-password` | Password reset with token |

---

## Dashboard Routes — `app/(dashboard)/dashboard/`

All require authentication. Redirects to `/login` if unauthenticated (handled in the dashboard layout).

| URL | Description |
|---|---|
| `/dashboard` | Main dashboard — overview, recent files, stats (Recharts usage graph) |
| `/dashboard/files` | File manager view (list/grid toggle, search, sort) |
| `/dashboard/_buckets` | Bucket management (note: prefixed with `_` → private/internal route) |
| `/dashboard/billing` | Billing — current plan, payment history, upgrade |
| `/dashboard/keys` | API key management (create, view, revoke) |
| `/dashboard/usage` | Bandwidth + storage usage charts (Recharts) |
| `/dashboard/settings` | Account settings (profile, password, notifications) |
| `/dashboard/shared` | Files you have shared (manage your share links) |
| `/dashboard/shared-with-me` | Files shared with you via share tokens |

---

## Onboarding Routes — `app/(onboarding)/`

| URL | Description |
|---|---|
| `/onboarding` | Multi-step new user onboarding (plan selection, first bucket creation) |

---

## Admin Routes — `app/admin/`

Requires admin session. These pages are NOT inside the `(dashboard)` group.

| URL | Description |
|---|---|
| `/admin` | Admin overview dashboard |
| `/admin/users` | User management table |
| `/admin/analytics` | System-wide analytics |

---

## API Routes — `app/api/`

See `02_API_ROUTES.md` for full API documentation.

---

## Special Files

| File | Purpose |
|---|---|
| `app/layout.tsx` | Root layout — applies fonts (Geist), wraps with Providers, adds PostHog |
| `app/globals.css` | CSS variables for theming + Tailwind base |
| `app/robots.ts` | Auto-generated `robots.txt` |
| `app/sitemap.ts` | Auto-generated XML sitemap (includes blog + changelog slugs) |
| `app/favicon.ico` | App favicon |

---

## Layout Hierarchy

```
app/layout.tsx                    ← Root: font, theme, PostHog, providers
  └── app/(auth)/layout.tsx       ← Auth: centered card layout, no sidebar
  └── app/(dashboard)/layout.tsx  ← Dashboard: sidebar nav + header layout
  └── app/admin/layout.tsx        ← Admin: separate admin nav layout
```
