/**
 * Shared PII-stripping for audit emitters (BillingEvent, ActivityLog).
 *
 * Audit payloads must never persist raw PII — store opaque ids, amounts, and
 * enums only. Both `emitBillingEvent` and `emitActivity` route payloads through
 * `sanitize` so the redaction rules can't drift between the two logs.
 */
export const PII_KEYS = new Set([
  "email",
  "phone",
  "name",
  "firstName",
  "lastName",
  "contact",
  "address",
  "billingAddress",
]);

export function sanitize(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { value: payload };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (PII_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}
