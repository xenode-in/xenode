import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { deriveKey, fromB64 } from "./utils";

/**
 * Generate a checksum-valid 12-word BIP39 recovery kit from 128 bits of
 * cryptographic entropy. The maintained @scure wordlist replaces the corrupt
 * embedded list.
 */
export function generateRecoveryKit(): { words: string[]; passphrase: string } {
  const passphrase = generateMnemonic(wordlist, 128);
  return { words: passphrase.split(" "), passphrase };
}

export function formatRecoveryKitDownload(words: string[]): string {
  const passphrase = words.join(" ").trim().replace(/\s+/gu, " ");
  if (!validateMnemonic(passphrase, wordlist)) {
    throw new Error("Recovery phrase is not valid BIP39");
  }
  return [
    "Xenode Recovery Kit",
    "===================",
    "",
    "Keep this file offline. These words can unlock your encrypted vault.",
    "Xenode support will never ask for them.",
    "",
    passphrase,
    "",
    `Generated: ${new Date().toISOString()}`,
  ].join("\n");
}

/**
 * Legacy caller boundary while the Accounts Vault v2 UI is taking ownership.
 * Phrase validation is strict; Vault v2 itself derives wrapping keys through
 * crypto-core Argon2id abstraction.
 */
export async function deriveRecoveryKey(
  words: string[],
  saltB64: string,
): Promise<CryptoKey> {
  const passphrase = words.join(" ").trim().replace(/\s+/gu, " ");
  if (!validateMnemonic(passphrase, wordlist)) {
    throw new Error("Recovery phrase is not valid BIP39");
  }
  return deriveKey(passphrase, new Uint8Array(fromB64(saltB64)));
}
