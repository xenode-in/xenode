import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { utf8 } from "./encoding";

/**
 * BIP39-based account recovery.
 *
 * The recovery kit is a standard 12-word BIP39 mnemonic (128 bits of entropy +
 * checksum). The 32-byte recovery *wrapping key* is derived deterministically
 * from the mnemonic — so the same words always reproduce the same key and can
 * unwrap the account's `recoveryEnvelope` (which seals the Account Root Key).
 *
 * This replaces the old opaque base64 recovery secret: BIP39 gives the user a
 * memorable, checksummed, standards-based phrase, while the wrapping key never
 * leaves this device.
 */

const RECOVERY_KEY_INFO = "xenode/recovery-key/v1";

/** Collapse whitespace + lowercase so a copy/paste of the phrase still validates. */
function normalizeMnemonic(words: string): string {
  return words.trim().toLowerCase().replace(/\s+/gu, " ");
}

/**
 * Derive the 256-bit recovery wrapping key from a 12-word BIP39 phrase.
 * Deterministic: the same phrase always yields the same key (used both when the
 * kit is created and later when the user recovers with their words).
 */
export async function deriveRecoveryKeyFromMnemonic(
  words: string,
): Promise<Uint8Array> {
  const normalized = normalizeMnemonic(words);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error("Invalid recovery phrase");
  }
  const seed = mnemonicToSeedSync(normalized); // 64-byte PBKDF2 seed
  const hkdf = await crypto.subtle.importKey("raw", seed as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: utf8(RECOVERY_KEY_INFO) as BufferSource,
    },
    hkdf,
    256,
  );
  return new Uint8Array(bits);
}

export interface RecoveryMnemonic {
  /** The 12-word BIP39 phrase to show the user (space-separated). */
  words: string;
  /** The 256-bit recovery wrapping key derived from `words`. */
  secret: Uint8Array;
}

/**
 * Generate a fresh 12-word recovery kit and its derived wrapping key. Show
 * `words` to the user (once) and seal the ARK under `secret` in the
 * `recoveryEnvelope`.
 */
export async function generateRecoveryMnemonic(): Promise<RecoveryMnemonic> {
  const words = generateMnemonic(wordlist, 128); // 12 words
  const secret = await deriveRecoveryKeyFromMnemonic(words);
  return { words, secret };
}

/** The 12 words as an array (for grid display). */
export function recoveryWords(words: string): string[] {
  return normalizeMnemonic(words).split(" ");
}

/** True if `words` is a syntactically valid 12-word BIP39 phrase. */
export function isValidRecoveryPhrase(words: string): boolean {
  return validateMnemonic(normalizeMnemonic(words), wordlist);
}
