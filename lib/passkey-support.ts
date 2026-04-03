// The ONLY check we can reliably do before registration.
// PRF support is confirmed at registration time via extensionResults.prf.enabled.
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

// DOMAIN SEPARATOR — public, deterministic, not secret.
// NEVER change this value. Changing it would invalidate all existing passkeys.
export const PRF_DOMAIN_SEP = "xenode-vault-key-v1"
export const PRF_EVAL_FIRST = new TextEncoder().encode(PRF_DOMAIN_SEP)
