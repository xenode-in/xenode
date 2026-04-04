export function toStoredCredentialId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64url")
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString("base64url")
  }

  return null
}

export function toLegacyStoredCredentialId(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

export function fromStoredCredentialId(value: string): string {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8")
    if (/^[A-Za-z0-9_-]+$/.test(decoded)) {
      return decoded
    }
  } catch {
    // fall through to original value
  }

  return value
}
