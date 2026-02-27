/**
 * lib/crypto/prf.ts
 * WebAuthn PRF extension — derive a Master Key from a passkey biometric.
 *
 * PRF (Pseudo-Random Function) is a WebAuthn extension that makes the
 * authenticator output a deterministic 32-byte secret tied to a per-user salt.
 * The same passkey + same salt = same bytes every time → reproducible Master Key
 * with zero user input beyond biometrics.
 *
 * References:
 *   https://simplewebauthn.dev/docs/advanced/prf
 *   https://w3c.github.io/webauthn/#prf-extension
 *
 * Browser support (Feb 2026):
 *   ✅ Chrome 128+ desktop/Android, Safari 18+ iOS/macOS, Google PM, iCloud Keychain
 *   ❌ Windows Hello, Firefox (hardware key only)
 */

/** Check if the browser supports the PRF extension at all (best-effort). */
export function isPRFSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    // PRF requires conditional mediation support as a proxy
    typeof window.PublicKeyCredential.isConditionalMediationAvailable === "function"
  );
}

/**
 * Register a new passkey WITH the PRF extension.
 * Returns the PRF output (32 bytes) to use as Master Key material,
 * plus the credential ID for future authentication.
 *
 * @param prfSalt - random 32-byte salt generated per-user (stored on server)
 * @param userId  - raw bytes of the user ID (for WebAuthn userHandle)
 * @param userName - display name shown in the passkey prompt
 */
export async function registerWithPRF(
  prfSalt: Uint8Array,
  userId: Uint8Array,
  userName: string,
): Promise<{
  credentialId: string;
  prfOutput: ArrayBuffer;
  supported: boolean;
}> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: {
      name: "Xenode",
      id: window.location.hostname,
    },
    user: {
      id: userId,
      name: userName,
      displayName: userName,
    },
    pubKeyCredParams: [
      { alg: -7, type: "public-key" },   // ES256
      { alg: -257, type: "public-key" }, // RS256 fallback
    ],
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    extensions: {
      // @ts-expect-error prf not in TS DOM types yet
      prf: {
        eval: {
          first: prfSalt.buffer,
        },
      },
    },
  };

  const credential = (await navigator.credentials.create({
    publicKey,
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error("Passkey registration cancelled");

  // Check if PRF output was returned
  // @ts-expect-error prf extension not in DOM types
  const prfResults = credential.getClientExtensionResults()?.prf;
  const prfOutput: ArrayBuffer | null = prfResults?.results?.first ?? null;

  const credentialId = btoa(
    String.fromCharCode(...new Uint8Array(credential.rawId)),
  );

  if (!prfOutput) {
    // Authenticator registered but doesn't support PRF output
    return { credentialId, prfOutput: new ArrayBuffer(0), supported: false };
  }

  return { credentialId, prfOutput, supported: true };
}

/**
 * Authenticate with an existing passkey and get the PRF output.
 * The PRF output is deterministic — same passkey + same salt = same bytes.
 *
 * @param prfSalt - the same salt used during registration (fetched from server)
 */
export async function authenticateWithPRF(prfSalt: Uint8Array): Promise<{
  prfOutput: ArrayBuffer;
  supported: boolean;
}> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge,
    userVerification: "required",
    rpId: window.location.hostname,
    extensions: {
      // @ts-expect-error prf extension not in DOM types
      prf: {
        eval: {
          first: prfSalt.buffer,
        },
      },
    },
  };

  const assertion = (await navigator.credentials.get({
    publicKey,
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error("Passkey authentication cancelled");

  // @ts-expect-error prf extension not in DOM types
  const prfResults = assertion.getClientExtensionResults()?.prf;
  const prfOutput: ArrayBuffer | null = prfResults?.results?.first ?? null;

  if (!prfOutput) {
    return { prfOutput: new ArrayBuffer(0), supported: false };
  }

  return { prfOutput, supported: true };
}

/**
 * Derive a 256-bit AES-GCM CryptoKey from PRF output using HKDF-SHA256.
 * HKDF stretches and domain-separates the PRF bytes into a proper key.
 */
export async function deriveKeyFromPRF(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    prfOutput,
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("xenode-vault-v1"),
      info: new TextEncoder().encode("master-key"),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
