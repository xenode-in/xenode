/**
 * Next.js Proxy configuration (replaces deprecated middleware file convention)
 *
 * Routes admin.xenode.in        →  /admin/*
 * Routes admin.localhost:3000   →  /admin/*
 *
 * Rules:
 *  1. On admin subdomain:
 *     - /api/admin/*  →  pass through as-is   (API routes already scoped)
 *     - /api/*        →  rewrite to /api/*     (shared APIs, pass through)
 *     - /admin/*      →  pass through as-is   (already prefixed)
 *     - /*            →  rewrite to /admin/*   (UI pages)
 *  2. On main domain:
 *     - /admin/*      →  404  (block direct access)
 *
 * Deploy:
 *   - DNS: add CNAME  admin.xenode.in → xenode.in
 *   - Same Next.js server handles both domains
 *
 * https://nextjs.org/docs/messages/middleware-to-proxy
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const ADMIN_HOSTNAMES = [
  "admin.xenode.in",
  "admin.localhost",
  "admin.localhost:3000",
];

const DOCS_HOSTNAMES = [
  "docs.xenode.in",
  "docs.localhost",
  "docs.localhost:3000",
];

const SHEETS_HOSTNAMES = [
  "sheets.xenode.in",
  "sheets.localhost",
  "sheets.localhost:3000",
];

const SHEETS_V2_HOSTNAMES = [
  "sheets-v2.xenode.in",
  "sheets-v2.localhost",
  "sheets-v2.localhost:3000",
];

/**
 * ── Defense-in-depth auth gate (main domain only) ────────────────────────────
 * A cheap, optimistic credential-presence check (no DB call) that bounces
 * unauthenticated traffic early. Route handlers + the dashboard layout remain
 * the real source of truth. Credential = a better-auth session cookie (web) OR
 * the `x-better-auth-cookie` header sent by the expo() mobile plugin.
 *
 * Scope is deliberately conservative — only unambiguously-private resources.
 * Sharing families (/api/share, /api/direct-shares, /api/albums) and other-auth
 * surfaces (/api/auth, /api/admin, /api/cron, payment webhooks) are NOT gated
 * here; they enforce their own (public-token / non-session) auth.
 */
const PROTECTED_PAGE_PREFIXES = ["/dashboard", "/sync", "/sheets", "/sheets-v2"];
const PROTECTED_API_PREFIXES = [
  "/api/objects",
  "/api/buckets",
  "/api/keys",
  "/api/sessions",
  "/api/usage",
  "/api/billing",
  "/api/subscriptions",
  "/api/refunds",
  "/api/support",
];

function hasCredential(req: NextRequest): boolean {
  if (getSessionCookie(req)) return true;
  if (req.headers.get("x-better-auth-cookie")) return true;
  return false;
}

function authGate(req: NextRequest): NextResponse | null {
  const { pathname, search } = req.nextUrl;

  const isProtectedApi = PROTECTED_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isProtectedPage = PROTECTED_PAGE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!isProtectedApi && !isProtectedPage) return null;
  if (hasCredential(req)) return null;

  if (isProtectedApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", pathname + search);
  return NextResponse.redirect(loginUrl);
}

export function proxy(req: NextRequest) {
  const hostname = req.headers.get("host") || "";
  const { pathname } = req.nextUrl;

  const isAdminHost = ADMIN_HOSTNAMES.some(
    (h) => hostname === h || hostname.startsWith(h),
  );

  // ── Admin subdomain ──────────────────────────────────────────────────────
  if (isAdminHost) {
    // 1. API routes — pass through without rewriting
    //    /api/admin/login  stays  /api/admin/login
    //    /api/*            stays  /api/*
    if (pathname.startsWith("/api/")) {
      return NextResponse.next();
    }

    // 2. Already prefixed with /admin — pass through
    if (pathname.startsWith("/admin")) {
      return NextResponse.next();
    }

    // 3. Everything else: rewrite to /admin prefix
    //    /          →  /admin
    //    /login     →  /admin/login
    //    /dashboard →  /admin/dashboard
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = `/admin${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(rewriteUrl);
  }

  const isDocsHost = DOCS_HOSTNAMES.some(
    (h) => hostname === h || hostname.startsWith(h),
  );

  // ── Docs subdomain ──────────────────────────────────────────────────────
  if (isDocsHost) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.next();
    }
    if (pathname.startsWith("/docs")) {
      return NextResponse.next();
    }
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = `/docs${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(rewriteUrl);
  }

  const isSheetsHost = SHEETS_HOSTNAMES.some(
    (h) => hostname === h || hostname.startsWith(h),
  );

  // Sheets subdomain: shared APIs pass through; UI is rooted at /sheets.
  if (isSheetsHost) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.next();
    }
    if (pathname.startsWith("/sheets")) {
      const gated = authGate(req);
      return gated ?? NextResponse.next();
    }
    const gated = authGate(req);
    if (gated) return gated;
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = "/sheets" + (pathname === "/" ? "" : pathname);
    return NextResponse.rewrite(rewriteUrl);
  }

  const isSheetsV2Host = SHEETS_V2_HOSTNAMES.some(
    (h) => hostname === h || hostname.startsWith(h),
  );

  // Sheets v2 subdomain: the current /sheets editor is never rewritten here.
  if (isSheetsV2Host) {
    if (
      pathname.startsWith("/api/") ||
      pathname.startsWith("/internal-editors/")
    ) {
      return NextResponse.next();
    }
    if (pathname.startsWith("/sheets-v2")) {
      const gated = authGate(req);
      return gated ?? NextResponse.next();
    }
    const gated = authGate(req);
    if (gated) return gated;
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname =
      "/sheets-v2" + (pathname === "/" ? "" : pathname);
    return NextResponse.rewrite(rewriteUrl);
  }
  // ── Main domain: block direct /admin access ──────────────────────────────
  if (pathname.startsWith("/admin")) {
    const url = req.nextUrl.clone();
    url.pathname = "/404";
    return NextResponse.rewrite(url);
  }

  // ── Main domain: defense-in-depth auth gate for private routes ────────────
  const gated = authGate(req);
  if (gated) return gated;

  return NextResponse.next();
}

export const config = {
  /*
   * Match everything EXCEPT:
   *   - Next.js internals  (_next/static, _next/image)
   *   - Static files       (favicon, images, css, js)
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
