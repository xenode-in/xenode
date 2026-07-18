const DYNAMIC_SEGMENT = "[id]";

const SENSITIVE_ROUTE_PATTERNS: Array<[RegExp, string]> = [
  [/^\/shared\/[^/]+$/, "/shared/[token]"],
  [/^\/dashboard\/_buckets\/[^/]+$/, "/dashboard/_buckets/[bucketId]"],
  [/^\/dashboard\/shared-with-me\/[^/]+$/, "/dashboard/shared-with-me/[id]"],
  [/^\/dashboard\/support\/[^/]+$/, "/dashboard/support/[id]"],
  [/^\/admin\/dashboard\/users\/[^/]+$/, "/admin/dashboard/users/[userId]"],
  [/^\/admin\/dashboard\/support\/[^/]+$/, "/admin/dashboard/support/[id]"],
  [/^\/admin\/dashboard\/billing\/refunds\/[^/]+$/, "/admin/dashboard/billing/refunds/[id]"],
  [/^\/admin\/dashboard\/blogs\/edit\/.+$/, "/admin/dashboard/blogs/edit/[slug]"],
];

function isLikelyIdentifier(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  if (/^[a-f0-9]{16,}$/i.test(segment)) return true;
  if (/^[a-z0-9_-]{12,}$/i.test(segment)) return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    segment,
  );
}

export function sanitizeAnalyticsPath(pathname: string): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const pathOnly = normalized.split(/[?#]/, 1)[0] || "/";

  for (const [pattern, replacement] of SENSITIVE_ROUTE_PATTERNS) {
    if (pattern.test(pathOnly)) return replacement;
  }

  return pathOnly
    .split("/")
    .map((segment, index) => {
      if (index === 0 || !segment) return segment;
      return isLikelyIdentifier(segment) ? DYNAMIC_SEGMENT : segment;
    })
    .join("/");
}

export function sanitizeAnalyticsUrl(value: string): string {
  try {
    const url = new URL(value, "https://analytics.invalid");
    const sanitizedPath = sanitizeAnalyticsPath(url.pathname);
    if (url.origin === "https://analytics.invalid") return sanitizedPath;
    return `${url.origin}${sanitizedPath}`;
  } catch {
    return sanitizeAnalyticsPath(value);
  }
}
