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

  // ── Main domain: block direct /admin access ──────────────────────────────
  if (pathname.startsWith("/admin")) {
    const url = req.nextUrl.clone();
    url.pathname = "/404";
    return NextResponse.rewrite(url);
  }

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
