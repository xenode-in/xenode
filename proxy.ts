/**
 * Next.js Proxy configuration (replaces deprecated middleware file convention)
 *
 * Routes admin.xenode.in  →  /admin/*
 * Routes admin.localhost  →  /admin/*
 *
 * Deploy notes:
 *   - Point admin.xenode.in DNS CNAME → xenode.in (same Next.js server)
 *   - The proxy rewrites the request path so /admin/* routes are served
 *
 * https://nextjs.org/docs/messages/middleware-to-proxy
 */

import { NextRequest, NextResponse } from "next/server";

const ADMIN_HOSTNAMES = [
  "admin.xenode.in",
  "admin.localhost",
  "admin.localhost:3000",
];

export function middleware(req: NextRequest) {
  const hostname = req.headers.get("host") || "";
  const { pathname } = req.nextUrl;

  // ── Admin subdomain routing ──────────────────────────────────────────────
  const isAdminHost = ADMIN_HOSTNAMES.some(
    (h) => hostname === h || hostname.startsWith(h)
  );

  if (isAdminHost) {
    // Already on an /admin/* path — don't double-prefix
    if (pathname.startsWith("/admin")) {
      return NextResponse.next();
    }

    // Rewrite /  →  /admin
    // Rewrite /login  →  /admin/login  etc.
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = `/admin${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(rewriteUrl);
  }

  // ── Block direct /admin access from non-admin hostnames ────────────────
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
   *   - Next.js internals (_next/static, _next/image)
   *   - Static files (favicon.ico, images, etc.)
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
