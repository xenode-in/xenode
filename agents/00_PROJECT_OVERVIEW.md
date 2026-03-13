# xnode — Project Overview

> **Purpose of this folder:** All `.md` files inside `/agents` are written for AI coding agents (Atigravity, Claude, Cursor, Copilot, etc.) to understand this codebase quickly and accurately. Read ALL files in this folder before making changes.

---

## What is xnode?

**xnode** is a full-stack, self-hosted cloud object storage SaaS — similar to AWS S3 or Cloudflare R2 — but with a polished web UI, billing, API key access, end-to-end encryption, and a public blog/changelog system.

Users can:
- Create **buckets** (logical namespaces for files)
- Upload, download, preview, and manage **objects** (files) within buckets
- Share files publicly via **share links** (with optional expiry and password)
- Access storage programmatically via **API keys**
- Monitor their **storage and bandwidth usage**
- Pay for storage plans via the **billing system**
- Enable **client-side AES-GCM encryption** for files

---

## Tech Stack (Quick Reference)

| Layer | Technology |
|---|---|
| Framework | **Next.js 16.1.6** — App Router, React 19, Server Components |
| Language | **TypeScript 5** throughout |
| Database | **MongoDB** via **Mongoose** (two connections: main + logs) |
| Auth | **better-auth** v1.4 (session-based, cookie auth) |
| Storage Backend | **Backblaze B2** via AWS S3-compatible SDK (`@aws-sdk/client-s3`) |
| File Upload | **Uppy** (Dashboard UI + AWS S3 multipart + XHR fallback) |
| Encryption | **AES-GCM** (Web Crypto API, client-side) |
| Payments | Custom payment integration (Razorpay-style webhook flow) |
| Analytics | **PostHog** (client + server-side) |
| UI Components | **shadcn/ui** + **Radix UI** + **Tailwind CSS v4** |
| Animations | **Framer Motion** + **Lenis** (smooth scroll) |
| Content (Blog/Changelog) | **MDX** files parsed with `gray-matter` + `next-mdx-remote` |
| Charts | **Recharts** (usage dashboard) |
| Validation | **Zod** v4 |
| Testing | **Vitest** |
| Deployment | **Docker** + `docker-compose` |

---

## Repository Structure (Top Level)

```
xnode/
├── agents/                  ← YOU ARE HERE — AI agent context docs
├── app/                     ← Next.js App Router (pages + API routes)
│   ├── (auth)/              ← Login, register, forgot-password pages
│   ├── (dashboard)/         ← Protected user dashboard
│   ├── (onboarding)/        ← New user onboarding flow
│   ├── admin/               ← Admin panel pages
│   ├── api/                 ← All API Route Handlers
│   ├── blog/                ← Public blog (MDX)
│   ├── changelog/           ← Public changelog (MDX)
│   ├── pricing/             ← Pricing page
│   ├── shared/              ← Public shared file viewer
│   ├── layout.tsx           ← Root layout (fonts, providers, analytics)
│   ├── page.tsx             ← Landing/marketing homepage
│   ├── globals.css          ← Tailwind + CSS variables
│   ├── robots.ts            ← SEO robots.txt
│   └── sitemap.ts           ← Dynamic sitemap generation
├── components/              ← Reusable React components
├── contexts/                ← React Context providers
├── hooks/                   ← Custom React hooks
├── lib/                     ← Server utilities, DB connections, services
├── models/                  ← Mongoose schemas (MongoDB)
├── providers/               ← App-level React providers
├── types/                   ← Global TypeScript type declarations
├── content/                 ← MDX source files (blog posts, changelog)
├── docs/                    ← Internal documentation
├── scripts/                 ← Utility/maintenance scripts
├── tests/                   ← Vitest test files
├── public/                  ← Static assets (images, icons)
├── .env.example             ← All required environment variables
├── Dockerfile               ← Production Docker image
├── docker-compose.yml       ← Local dev with Docker
├── next.config.ts           ← Next.js configuration
├── components.json          ← shadcn/ui CLI config
├── mdx-components.tsx       ← Custom MDX element overrides
├── proxy.ts                 ← Dev proxy server
├── vitest.config.ts         ← Test configuration
├── tsconfig.json            ← TypeScript config
├── eslint.config.mjs        ← ESLint config
└── BILLING_SECURITY.md      ← Billing security documentation
```

---

## Default Branch

The default branch is **`master`** (not `main`).

---

## Key Architectural Decisions

1. **Monolithic Next.js** — Frontend and API live together in one repo. No separate backend service.
2. **Backblaze B2 as storage** — All binary file data goes to B2. MongoDB only stores metadata.
3. **Two MongoDB connections** — `lib/mongodb.ts` (main app data) and `lib/mongodb-logs.ts` (API request logs, kept separate for performance).
4. **Client-side encryption is optional** — Users can enable AES-GCM encryption. The encrypted key is stored in `UserKeyVault`, never the raw key.
5. **API keys are first-class** — Developers can use xnode programmatically. Every API key request is logged in `ApiLog`.
6. **File-based content** — Blog and changelog are `.mdx` files in `/content`, not a CMS or database.
7. **Presigned URLs for downloads** — Files are never proxied through Next.js; presigned B2 URLs are generated and cached in `lib/downloadCache.ts`.
