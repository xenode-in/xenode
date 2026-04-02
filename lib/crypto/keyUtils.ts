/**
 * lib/crypto/keyUtils.ts
 * Browser-only utilities for deriving keys from passwords.
 */

import { deriveKey } from "./utils";

/**
 * Derives a 256-bit AES-GCM CryptoKey from a password and salt.
 * Uses PBKDF2-SHA256 with 600,000 iterations (standard across Xenode).
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  return deriveKey(password, salt as any);
}
