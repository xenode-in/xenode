import { startAuthentication, startRegistration } from "@simplewebauthn/browser"
import { fromB64, toB64 } from "@/lib/crypto/utils"
import { cacheKeys } from "@/lib/crypto/keyCache"
import { PRF_EVAL_FIRST } from "./passkey-support"

const RSA_PARAMS = {
  name: "RSA-OAEP",
  modulusLength: 4096,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
} as const

function toB64url(buf: ArrayBuffer | Uint8Array): string {
  const base64 = toB64(buf instanceof Uint8Array ? (buf.buffer as ArrayBuffer) : buf)
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

function fromB64url(s: string): Uint8Array {
  return fromB64(s.replace(/-/g, "+").replace(/_/g, "/"))
}

function toArrayBuffer(value: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer
}

function normalizePrfResult(
  value: string | ArrayBuffer | ArrayBufferView | undefined,
): ArrayBuffer | null {
  if (!value) return null
  if (typeof value === "string") {
    return fromB64url(value).buffer as ArrayBuffer
  }
  return toArrayBuffer(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getPrfFirst(result: unknown) {
  if (!isObject(result)) return undefined
  const clientExtensionResults = result.clientExtensionResults
  if (!isObject(clientExtensionResults)) return undefined
  const prf = clientExtensionResults.prf
  if (!isObject(prf)) return undefined
  const prfResults = prf.results
  if (!isObject(prfResults)) return undefined
  const first = prfResults.first
  if (
    typeof first === "string" ||
    first instanceof ArrayBuffer ||
    ArrayBuffer.isView(first)
  ) {
    return first
  }
  return undefined
}

function isPrfEnabled(result: unknown) {
  if (!isObject(result)) return false
  const clientExtensionResults = result.clientExtensionResults
  if (!isObject(clientExtensionResults)) return false
  const prf = clientExtensionResults.prf
  return isObject(prf) && prf.enabled === true
}

function isNotAllowedError(err: unknown): err is { name: string } {
  return isObject(err) && typeof err.name === "string"
}

function withPrfEval<T extends { extensions?: Record<string, unknown> }>(
  options: T,
) {
  return {
    ...options,
    extensions: {
      ...options.extensions,
      prf: {
        ...((options.extensions?.prf as Record<string, unknown> | undefined) || {}),
        eval: {
          ...(
            ((options.extensions?.prf as { eval?: Record<string, unknown> } | undefined)
              ?.eval || {})
          ),
          first: PRF_EVAL_FIRST,
        },
      },
    },
  }
}

async function deriveWrapKey(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const km = await crypto.subtle.importKey(
    "raw",
    prfOutput,
    { name: "HKDF" },
    false,
    ["deriveKey"],
  )

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("xenode-prf-wrap-salt-v1"),
      info: new TextEncoder().encode("vault-wrap-key"),
    },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

async function encryptPrivKeyBuf(
  privateKeyBuf: ArrayBuffer,
  wrapKey: CryptoKey,
): Promise<{ encryptedVaultKey: string; vaultKeyIV: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    wrapKey,
    privateKeyBuf,
  )

  return {
    encryptedVaultKey: toB64url(enc as ArrayBuffer),
    vaultKeyIV: toB64url(iv),
  }
}

async function decryptToKeys(
  encryptedVaultKey: string,
  vaultKeyIV: string,
  wrapKey: CryptoKey,
  publicKeyB64: string,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; metadataKey: CryptoKey }> {
  const privateKeyBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(vaultKeyIV).buffer as ArrayBuffer },
    wrapKey,
    fromB64url(encryptedVaultKey).buffer as ArrayBuffer,
  )

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBuf,
    RSA_PARAMS,
    false,
    ["decrypt"],
  )

  const publicKey = await crypto.subtle.importKey(
    "spki",
    fromB64(publicKeyB64).buffer as ArrayBuffer,
    RSA_PARAMS,
    false,
    ["encrypt"],
  )

  const metadataKey = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", privateKeyBuf),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )

  return { privateKey, publicKey, metadataKey }
}

export type RegisterResult =
  | { ok: true }
  | { ok: false; prfUnsupported: true }
  | { ok: false; prfUnsupported: false }

export async function registerPasskeyWithPRF(
  privateKeyBuf: ArrayBuffer,
): Promise<RegisterResult> {
  const optRes = await fetch("/api/passkey/register/start", { method: "POST" })
  if (!optRes.ok) return { ok: false, prfUnsupported: false }
  const options = await optRes.json()
  const registrationNonce =
    typeof options.nonce === "string" ? options.nonce : null
  if (!registrationNonce) return { ok: false, prfUnsupported: false }

  let credential: unknown
  try {
    credential = await startRegistration({ optionsJSON: withPrfEval(options) })
  } catch (err) {
    console.error("Registration failed:", err)
    return { ok: false, prfUnsupported: false }
  }

  if (!isPrfEnabled(credential)) {
    localStorage.setItem("xenode_prf_unsupported", "1")
    return { ok: false, prfUnsupported: true }
  }

  const prfOutputBuffer = normalizePrfResult(
    getPrfFirst(credential),
  )

  if (!prfOutputBuffer) {
    localStorage.setItem("xenode_prf_unsupported", "1")
    return { ok: false, prfUnsupported: true }
  }

  const wrapKey = await deriveWrapKey(prfOutputBuffer)
  const { encryptedVaultKey, vaultKeyIV } = await encryptPrivKeyBuf(
    privateKeyBuf,
    wrapKey,
  )

  const finishRes = await fetch("/api/passkey/register/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      credential,
      encryptedVaultKey,
      vaultKeyIV,
      nonce: registrationNonce,
    }),
  })

  if (!finishRes.ok) return { ok: false, prfUnsupported: false }
  return { ok: true }
}

export async function signInWithPasskeyPRF(): Promise<
  | { ok: true; privateKey: CryptoKey; publicKey: CryptoKey; metadataKey: CryptoKey }
  | { ok: false; reason: "cancelled" | "prf_failed" | "server_error" | "no_vault" }
> {
  const optRes = await fetch("/api/passkey/login/start", { method: "POST" })
  if (!optRes.ok) return { ok: false, reason: "server_error" }
  const options = await optRes.json()

  let assertion: unknown
  try {
    assertion = await startAuthentication({ optionsJSON: withPrfEval(options) })
  } catch (err: unknown) {
    if (isNotAllowedError(err) && err.name === "NotAllowedError") {
      return { ok: false, reason: "cancelled" }
    }
    console.error("Authentication failed:", err)
    return { ok: false, reason: "prf_failed" }
  }

  const prfOutputBuffer = normalizePrfResult(
    getPrfFirst(assertion),
  )
  if (!prfOutputBuffer) return { ok: false, reason: "prf_failed" }

  const finishRes = await fetch("/api/passkey/login/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential: assertion, nonce: options.nonce }),
  })
  if (!finishRes.ok) return { ok: false, reason: "server_error" }

  const {
    encryptedVaultKey,
    vaultKeyIV,
    publicKey: publicKeyB64,
    hasVault,
  } = await finishRes.json()
  if (!hasVault) return { ok: false, reason: "no_vault" }

  const wrapKey = await deriveWrapKey(prfOutputBuffer)
  const keys = await decryptToKeys(
    encryptedVaultKey,
    vaultKeyIV,
    wrapKey,
    publicKeyB64,
  )

  await cacheKeys(keys.privateKey, keys.publicKey, keys.metadataKey)

  return { ok: true, ...keys }
}
