/**
 * Single source of truth for the post-failure / post-expiry grace window.
 * Used by: the expire-plans cron, the halted/past_due webhook handler,
 * enforceStorageAccess, and the UI banner countdown. Keep these in sync.
 */
export const SUBSCRIPTION_GRACE_PERIOD_DAYS = 7;
export const SUBSCRIPTION_GRACE_PERIOD_MS =
  SUBSCRIPTION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

export const ACTIVE_SUBSCRIPTION_STATUSES = [
  "created",
  "authenticated",
  "active",
  "pending",
  "halted",
] as const;
