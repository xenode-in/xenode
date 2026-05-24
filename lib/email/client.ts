import { Resend } from "resend";

/**
 * Resend client singleton — billing/support emails reuse the same provider
 * already wired for OTPs. Reads RESEND_API_KEY at first use. Falls back to a
 * stub key in dev so missing-env crashes are caught when an email actually
 * tries to send (and logged), not at module load.
 */

let _client: Resend | null = null;

export function getResend(): Resend {
  if (!_client) {
    _client = new Resend(process.env.RESEND_API_KEY || "fallback");
  }
  return _client;
}

export const EMAIL_FROM =
  process.env.EMAIL_FROM || "Xenode <noreply@alerts.xenode.in>";

export const ADMIN_NOTIFY_EMAIL =
  process.env.ADMIN_NOTIFY_EMAIL || "support@xenode.in";

export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
