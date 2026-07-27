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

const DRIVE_SESSION_COOKIE = "xenode_drive_session";

const ADMIN_HOSTNAMES = [
  "admin.xenode.in",
  "admin.localhost",
  "admin.localhost:3000",
];

const RETIRED_HOSTNAMES = [
  "sheets-v2.xenode.in",
  "sheets-v2.localhost",
];

const FILE_RUNTIME_HOSTNAMES = [
  "preview.xenode.in",
  "edit.xenode.in",
];

/**
 * ── Defense-in-depth auth gate (main domain only) ────────────────────────────
 * A cheap, optimistic credential-presence check (no DB call) that bounces
 * unauthenticated traffic early. Route handlers + the dashboard layout remain
 * the real source of truth. Credential = the host-only Drive ProductSession
 * cookie (web) OR an `Authorization: Bearer <sessionId>` header (non-browser
 * clients; mobile re-integrates via the xenode-mobile OIDC client).
 *
 * Scope is deliberately conservative — only unambiguously-private resources.
 * Sharing families (/api/share, /api/direct-shares) and other-auth
 * surfaces (/api/admin, /api/cron, payment webhooks) are NOT gated
 * here; they enforce their own (public-token / non-session) auth.
 */
const PROTECTED_PAGE_PREFIXES = ["/dashboard", "/sync"];
const PROTECTED_API_PREFIXES = [
  "/api/objects",
  "/api/buckets",
  "/api/keys",
  "/api/usage",
  "/api/billing",
  "/api/subscriptions",
  "/api/refunds",
  "/api/support",
];

function hasCredential(req: NextRequest): boolean {
  if (req.cookies.get(DRIVE_SESSION_COOKIE)?.value) return true;
  if (req.headers.get("authorization")?.startsWith("Bearer ")) return true;
  return false;
}

function authGate(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl;

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
  // Kick off the Accounts OIDC flow; it lands back on /dashboard.
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/auth/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export function proxy(req: NextRequest) {
  const hostname = req.headers.get("host") || "";
  const hostnameWithoutPort = hostname.split(":")[0];
  const { pathname } = req.nextUrl;

  const legacyDrivePage = [
    "/dashboard",
    "/organizations",
    "/onboarding",
    "/invite",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (hostnameWithoutPort === "xenode.in" && legacyDrivePage) {
    const canonical = new URL(
      `${pathname}${req.nextUrl.search}`,
      "https://drive.xenode.in",
    );
    return NextResponse.redirect(canonical, 308);
  }

  if (RETIRED_HOSTNAMES.includes(hostnameWithoutPort)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  if (FILE_RUNTIME_HOSTNAMES.includes(hostnameWithoutPort)) {
    return new NextResponse("Not Found", { status: 404 });
  }


  const isAdminHost = ADMIN_HOSTNAMES.some(
    (h) => hostname === h || hostname.startsWith(h),
  );

  // ── Admin subdomain ──────────────────────────────────────────────────────
  if (isAdminHost) {
    // 1. API routes — pass through without rewriting
    //    /api/admin/login  stays  /api/admin/login
    //    /api/*            stays  /api/*
    if (pathname.startsWith("/api/")) {
      const protocol = hostname.includes("localhost") ? "http" : "https";
      const adminOrigin = `${protocol}://${hostname}`;
      const origin = req.headers.get("origin");
      const fetchSite = req.headers.get("sec-fetch-site");
      const isMutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (
        fetchSite === "same-site" ||
        (origin !== null && origin !== adminOrigin) ||
        (isMutation && fetchSite !== null && origin !== adminOrigin)
      ) {
        return NextResponse.json(
          { error: "Cross-origin admin API requests are forbidden" },
          { status: 403 },
        );
      }
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

  if (pathname === "/sync") {
    const url = req.nextUrl.clone();
    url.pathname = "/404";
    return NextResponse.rewrite(url);
  }

  // Same-site renderer subdomains are not trusted application callers.
  const appOrigin =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === "production"
      ? "https://drive.xenode.in" : "http://localhost:3000");
  if (pathname.startsWith("/api/")) {
    const origin = req.headers.get("origin");
    const fetchSite = req.headers.get("sec-fetch-site");
    const isMutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (
      (origin !== null && origin !== appOrigin) ||
      fetchSite === "same-site" ||
      (isMutation && fetchSite !== null && origin !== appOrigin)
    ) {
      return NextResponse.json(
        { error: "Cross-origin application API requests are forbidden" },
        { status: 403 },
      );
    }
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
