const ACTION_LABELS: Record<string, string> = {
  "account.session.created": "Signed in to Xenode Account",
  "account.profile.updated": "Updated account profile",
  "account.connector.linked": "Connected an external account",
  "account.connector.unlinked": "Disconnected an external account",
  "product_session.created": "Signed in to a Xenode product",
  "product_session.revoked": "Revoked a product session",
  "vault.created": "Created encrypted Vault",
  "vault.updated": "Updated encrypted Vault",
  "key_handoff.created": "Prepared a product key handoff",
  "key_handoff.consumed": "Completed a product key handoff",
};

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replaceAll(/[._-]+/gu, " ").replace(/^./u, (letter) => letter.toUpperCase());
}

export function bytesLabel(bytes: number | null | undefined): string {
  if (bytes == null) return "Unlimited";
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** power;
  return `${value >= 10 || power === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[power]}`;
}

export function usagePercent(used: number, limit: number | null): number {
  if (limit == null || limit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}

export function resumeAuthorizationPath(search: URLSearchParams): string {
  const allowed = new Set([
    "client_id", "redirect_uri", "response_type", "scope", "state", "nonce",
    "code_challenge", "code_challenge_method", "prompt", "max_age",
    "resource", "request_uri", "exp", "ba_iat", "ba_param", "ba_pl", "sig",
  ]);
  const target = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (allowed.has(key) && value) target.append(key, value);
  }
  const query = target.toString();
  return query ? `/api/auth/oauth2/authorize?${query}` : "/";
}
