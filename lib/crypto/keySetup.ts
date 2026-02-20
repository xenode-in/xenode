/**
 * lib/crypto/keySetup.ts
 * Key vault setup and unlock — browser only.
 */

import { toB64, fromB64, deriveKey } from "./utils";

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 4096,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

/**
 * Generate a new RSA-4096 keypair for the user, encrypt the private key with
 * a PBKDF2-derived master key, and POST the vault to the server.
 *
 * Call this once on first login / account setup.
 */
export async function setupUserKeyVault(password: string): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  // 1. Generate RSA-OAEP keypair (extractable so we can export it)
  const keypair = await crypto.subtle.generateKey(RSA_PARAMS, true, [
    "encrypt",
    "decrypt",
  ]);

  // 2. Export public key (stored plaintext on server — safe)
  const publicKeyBuf = await crypto.subtle.exportKey("spki", keypair.publicKey);

  // 3. Derive master key from password
  const salt = crypto.getRandomValues(
    new Uint8Array(16),
  ) as Uint8Array<ArrayBuffer>;
  const masterKey = await deriveKey(password, salt);

  // 4. Encrypt private key with master key
  const privateKeyBuf = await crypto.subtle.exportKey(
    "pkcs8",
    keypair.privateKey,
  );
  const iv = crypto.getRandomValues(
    new Uint8Array(12),
  ) as Uint8Array<ArrayBuffer>;
  const encryptedPrivKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    masterKey,
    privateKeyBuf,
  );

  // 5. POST vault to server
  const res = await fetch("/api/keys/vault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: toB64(publicKeyBuf),
      encryptedPrivateKey: toB64(encryptedPrivKey),
      pbkdf2Salt: toB64(salt),
      iv: toB64(iv),
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to save key vault");
  }

  // 6. Re-import private key as non-extractable for in-memory use
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBuf,
    RSA_PARAMS,
    false, // non-extractable
    ["decrypt"],
  );

  return { privateKey, publicKey: keypair.publicKey };
}

/**
 * Fetch the encrypted vault from the server, derive the master key from the
 * user's password, and decrypt the private key.
 *
 * Call this on every login / page load (after the user enters their password).
 */
export async function unlockVault(password: string): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  const res = await fetch("/api/keys/vault");
  if (res.status === 404) {
    throw new Error("NO_VAULT"); // sentinel — caller shows setup screen
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to fetch key vault");
  }

  const {
    publicKey: publicKeyB64,
    encryptedPrivateKey,
    pbkdf2Salt,
    iv,
  } = await res.json();

  // Derive master key
  const salt = fromB64(pbkdf2Salt);
  const masterKey = await deriveKey(password, salt);

  // Decrypt private key
  let privateKeyBuf: ArrayBuffer;
  try {
    privateKeyBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(iv) },
      masterKey,
      fromB64(encryptedPrivateKey),
    );
  } catch {
    throw new Error("WRONG_PASSWORD");
  }

  // Import keys as non-extractable CryptoKey objects
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBuf,
    RSA_PARAMS,
    false,
    ["decrypt"],
  );

  const publicKey = await crypto.subtle.importKey(
    "spki",
    fromB64(publicKeyB64),
    RSA_PARAMS,
    false,
    ["encrypt"],
  );

  return { privateKey, publicKey };
}
