import { startRegistration, startAuthentication } from "@simplewebauthn/browser"
import { fromB64, toB64 } from "@/lib/crypto/utils"
import { cacheKeys } from "@/lib/crypto/keyCache"
import { PRF_EVAL_FIRST } from "./passkey-support"

const RSA_PARAMS = {
  name: "RSA-OAEP",
  modulusLength: 4096,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
} as const

// ─── Encode/decode (base64url, matches your existing toB64/fromB64 convention) ──

function toB64url(buf: ArrayBuffer | Uint8Array): string {
  const base64 = toB64(buf instanceof Uint8Array ? buf.buffer as ArrayBuffer : buf)
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

function fromB64url(s: string): Uint8Array {
  return fromB64(s.replace(/-/g, "+").replace(/_/g, "/"))
}

// ─── PRF → wrap key (same derivation every time, same device) ───────────────

async function deriveWrapKey(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const km = await crypto.subtle.importKey("raw", prfOutput, { name: "HKDF" }, false, ["deriveKey"])
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("xenode-prf-wrap-salt-v1"),
      info: new TextEncoder().encode("vault-wrap-key")
    },
    km,
    { name: "AES-GCM", length: 256 },
    false,   // non-extractable, lives in memory only
    ["encrypt", "decrypt"]
  )
}

// ─── Encrypt/decrypt the raw private key buffer ──────────────────────────────

async function encryptPrivKeyBuf(
  privateKeyBuf: ArrayBuffer, wrapKey: CryptoKey
): Promise<{ encryptedVaultKey: string; vaultKeyIV: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer }, wrapKey, privateKeyBuf)
  return { encryptedVaultKey: toB64url(enc as ArrayBuffer), vaultKeyIV: toB64url(iv) }
}

async function decryptToKeys(
  encryptedVaultKey: string, vaultKeyIV: string, wrapKey: CryptoKey,
  publicKeyB64: string
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; metadataKey: CryptoKey }> {
  const privateKeyBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(vaultKeyIV).buffer as ArrayBuffer },
    wrapKey,
    fromB64url(encryptedVaultKey).buffer as ArrayBuffer
  )
  const privateKey = await crypto.subtle.importKey("pkcs8", privateKeyBuf, RSA_PARAMS, false, ["decrypt"])
  const publicKey = await crypto.subtle.importKey(
    "spki", fromB64(publicKeyB64).buffer as ArrayBuffer, RSA_PARAMS, false, ["encrypt"]
  )
  // Matches your exact metadataKey derivation in keySetup.ts
  const metadataKey = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", privateKeyBuf),
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  )
  return { privateKey, publicKey, metadataKey }
}

// ─── Registration ─────────────────────────────────────────────────────────────

export type RegisterResult =
  | { ok: true }
  | { ok: false; prfUnsupported: true }
  | { ok: false; prfUnsupported: false }

export async function registerPasskeyWithPRF(
  privateKeyBuf: ArrayBuffer
): Promise<RegisterResult> {
  // 1. Get registration options
  const optRes = await fetch("/api/passkey/register/start", { method: "POST" })
  if (!optRes.ok) return { ok: false, prfUnsupported: false }
  const options = await optRes.json()

  // 2. Call startRegistration — use { optionsJSON } for v10+ compatibility
  let credential: any
  try {
    credential = await startRegistration({ optionsJSON: options })
  } catch (err) {
    console.error("Registration failed:", err)
    return { ok: false, prfUnsupported: false }
  }

  // 3. PRF enabled check
  if (credential.clientExtensionResults?.prf?.enabled !== true) {
    localStorage.setItem("xenode_prf_unsupported", "1")
    return { ok: false, prfUnsupported: true }
  }

  // 4. Immediately do a get() to derive PRF output while user gesture is active
  const authOptRes = await fetch("/api/passkey/login/start", { method: "POST" })
  if (!authOptRes.ok) return { ok: false, prfUnsupported: false }
  const authOptions = await authOptRes.json()

  let assertion: any
  try {
    // Only allow the credential we just created
    const scopedOptions = {
      ...authOptions,
      allowCredentials: [{ 
        type: "public-key", 
        id: credential.id, 
        transports: credential.response.transports 
      }],
    }
    assertion = await startAuthentication({ optionsJSON: scopedOptions })
  } catch (err) {
    console.error("Verification failed:", err)
    return { ok: false, prfUnsupported: false }
  }

  const prfOutputB64: string | undefined =
    assertion.clientExtensionResults?.prf?.results?.first

  if (!prfOutputB64) {
    localStorage.setItem("xenode_prf_unsupported", "1")
    return { ok: false, prfUnsupported: true }
  }

  // 5. Derive wrap key, encrypt the private key buffer
  const wrapKey = await deriveWrapKey(fromB64url(prfOutputB64).buffer as ArrayBuffer)
  const { encryptedVaultKey, vaultKeyIV } = await encryptPrivKeyBuf(privateKeyBuf, wrapKey)

  // 6. Register the credential + store encrypted vault key on server
  const finishRes = await fetch("/api/passkey/register/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      credential,
      encryptedVaultKey,
      vaultKeyIV,
    }),
  })

  if (!finishRes.ok) return { ok: false, prfUnsupported: false }
  return { ok: true }
}

// ─── Login ─────────────────────────────────────────────────────────────────────

export async function signInWithPasskeyPRF(): Promise<
  | { ok: true; privateKey: CryptoKey; publicKey: CryptoKey; metadataKey: CryptoKey }
  | { ok: false; reason: "cancelled" | "prf_failed" | "server_error" | "no_vault" }
> {
  const optRes = await fetch("/api/passkey/login/start", { method: "POST" })
  if (!optRes.ok) return { ok: false, reason: "server_error" }
  const options = await optRes.json()

  let assertion: any
  try {
    // Pass { optionsJSON } directly — server already included PRF eval extensions
    assertion = await startAuthentication({ optionsJSON: options })
  } catch (err: any) {
    if (err.name === 'NotAllowedError') return { ok: false, reason: "cancelled" }
    console.error("Authentication failed:", err)
    return { ok: false, reason: "prf_failed" }
  }

  const prfOutputB64: string | undefined =
    assertion.clientExtensionResults?.prf?.results?.first

  if (!prfOutputB64) return { ok: false, reason: "prf_failed" }

  // Server verifies assertion, creates session, returns encrypted vault key + public key
  const finishRes = await fetch("/api/passkey/login/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential: assertion, nonce: options.nonce }),
  })
  if (!finishRes.ok) return { ok: false, reason: "server_error" }

  const { encryptedVaultKey, vaultKeyIV, publicKey: publicKeyB64, hasVault } = await finishRes.json()
  if (!hasVault) return { ok: false, reason: "no_vault" }

  const wrapKey = await deriveWrapKey(fromB64url(prfOutputB64).buffer as ArrayBuffer)
  const keys = await decryptToKeys(encryptedVaultKey, vaultKeyIV, wrapKey, publicKeyB64)

  // Cache keys into IndexedDB
  await cacheKeys(keys.privateKey, keys.publicKey, keys.metadataKey)

  return { ok: true, ...keys }
}
