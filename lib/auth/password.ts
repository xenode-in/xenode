import crypto from "node:crypto";

const SCRYPT_OPTIONS = {
  N: 16384,
  r: 16,
  p: 1,
  maxmem: 128 * 16384 * 16 * 2,
} as const;

export function verifyStoredPasswordHash(
  password: string,
  storedHash: string,
): boolean {
  const [salt, expectedHex] = storedHash.split(":");

  if (!salt || !expectedHex) {
    return false;
  }

  const normalizedPassword = password.normalize("NFKC");
  const actual = crypto.scryptSync(normalizedPassword, salt, 64, SCRYPT_OPTIONS);
  const expected = Buffer.from(expectedHex, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);
}
