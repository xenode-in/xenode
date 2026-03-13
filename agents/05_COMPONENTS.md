# Components — UI Component Reference

All reusable React components live in `components/`. They are organized by feature domain.

---

## Root-Level Components

| File | Description |
|---|---|
| `components/Navbar.tsx` | Marketing site navbar — logo, nav links, login/signup CTA, theme toggle |
| `components/PricingComparison.tsx` | Pricing table with plan features comparison |
| `components/AnimatedLink.tsx` | Framer Motion animated underline link |
| `components/SmoothScrollWrapper.tsx` | Wraps children with Lenis smooth scroll |
| `components/share-dialog.tsx` | Modal for creating/managing share links (password, expiry, copy URL) |
| `components/theme-toggle.tsx` | Dark/light mode toggle button (next-themes) |

---

## `components/ui/` — shadcn/ui Base Components

Auto-generated shadcn/ui primitives. Do NOT manually edit these — use `npx shadcn add <component>` to add new ones.

Includes: `button`, `input`, `dialog`, `dropdown-menu`, `table`, `badge`, `card`, `tabs`, `tooltip`, `skeleton`, `progress`, `avatar`, `sheet`, `select`, `checkbox`, `label`, `separator`, `scroll-area`, `context-menu`, `popover`, `switch`, and more.

---

## `components/dashboard/` — Dashboard UI

Components used inside `app/(dashboard)/dashboard/`.

| Component | Description |
|---|---|
| `DashboardSidebar.tsx` | Left sidebar with nav links (Files, Buckets, Keys, Usage, Billing, Settings) |
| `DashboardHeader.tsx` | Top header with breadcrumb, search, user avatar |
| `FileTable.tsx` | Main file listing table with sortable columns, actions, checkboxes |
| `FileGrid.tsx` | Grid view of files with thumbnails |
| `BucketCard.tsx` | Bucket overview card (name, size, object count) |
| `UsageBar.tsx` | Progress bar showing storage/bandwidth used vs limit |
| `FilePreviewModal.tsx` | In-browser file preview (image, video, PDF, text) |
| `UploadButton.tsx` | Triggers the Uppy upload modal |
| `FileContextMenu.tsx` | Right-click context menu on files (download, share, rename, delete) |
| `FolderBreadcrumb.tsx` | Path breadcrumb for folder navigation |

---

## `components/upload/` — Upload Components

| Component | Description |
|---|---|
| `UploadModal.tsx` | Uppy Dashboard modal wrapper |
| `UploadProgress.tsx` | Active upload progress indicator (uses UploadContext) |
| `EncryptionToggle.tsx` | Toggle to enable AES-GCM encryption before upload |

---

## `components/landing/` — Marketing/Landing Page Components

| Component | Description |
|---|---|
| `HeroSection.tsx` | Main hero with headline, CTA buttons |
| `FeaturesSection.tsx` | Feature highlights grid |
| `HowItWorksSection.tsx` | Step-by-step explainer |
| `StatsSection.tsx` | Numbers/social proof |
| `CTASection.tsx` | Bottom call-to-action |
| `Footer.tsx` | Site footer with links |

---

## `components/onboarding/` — Onboarding Flow

Multi-step wizard components for new user onboarding.

| Component | Description |
|---|---|
| `OnboardingStep1.tsx` | Welcome + plan selection |
| `OnboardingStep2.tsx` | Create first bucket |
| `OnboardingStep3.tsx` | Upload first file (optional) |
| `OnboardingProgress.tsx` | Step indicator |

---

## `components/settings/` — Settings Forms

| Component | Description |
|---|---|
| `ProfileForm.tsx` | Update display name and email |
| `PasswordForm.tsx` | Change password |
| `EncryptionSettings.tsx` | Enable/disable encryption, manage key vault |
| `DangerZone.tsx` | Delete account |

---

## `components/admin/` — Admin Panel Components

| Component | Description |
|---|---|
| `UsersTable.tsx` | Paginated users table with plan badges |
| `AdminStats.tsx` | System stats cards (total users, storage, revenue) |

---

## `components/providers/` — Provider Components

Thin wrapper components that provide React context to children. See `contexts/` and `providers/` for the actual context logic.
