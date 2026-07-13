export const ONLYOFFICE_ARTIFACT_VERSION =
  process.env.NEXT_PUBLIC_ONLYOFFICE_ARTIFACT_VERSION ??
  // CryptPad's patched, server-less editor + x2t at 9.3.0.140 (see
  // docs/ONLYOFFICE_EDITOR_V2_PLAN.md). The earlier stock 9.4.0.131 build could
  // not edit server-less; this is the whole stack aligned to CryptPad's 9.3.
  "9.3.0.140-cryptpad.2-xenode.1";

const configuredBase =
  process.env.NEXT_PUBLIC_ONLYOFFICE_EDITOR_BASE_URL ??
  "/internal-editors/onlyoffice";

export const ONLYOFFICE_EDITOR_BASE_URL = configuredBase.replace(/\/$/, "");

export const ONLYOFFICE_EDITOR_URL =
  `${ONLYOFFICE_EDITOR_BASE_URL}/${ONLYOFFICE_ARTIFACT_VERSION}`;

export const ONLYOFFICE_API_URL =
  `${ONLYOFFICE_EDITOR_URL}/web-apps/apps/api/documents/api.js`;

/** URL of the Xenode frame host served from the editor origin. */
export const ONLYOFFICE_HOST_URL = `${ONLYOFFICE_EDITOR_URL}/xenode/host.html?rev=save-ack-1`;

/** Explicit editor origin for production (e.g. `https://sheets-v2.xenode.in`).
 *  When unset we treat the editor as same-origin (dev / relative asset path). */
const configuredOrigin = process.env.NEXT_PUBLIC_ONLYOFFICE_EDITOR_ORIGIN ?? "";

/** Resolve the exact origin the iframe will run at, for postMessage targeting
 *  and origin validation. Never returns a wildcard. */
export function resolveEditorOrigin(): string {
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, "");
  // Absolute base URL configured (CDN / editor subdomain): derive its origin.
  if (/^https?:\/\//i.test(ONLYOFFICE_EDITOR_BASE_URL)) {
    try {
      return new URL(ONLYOFFICE_EDITOR_BASE_URL).origin;
    } catch {
      /* fall through to same-origin */
    }
  }
  return typeof window !== "undefined" ? window.location.origin : "";
}
