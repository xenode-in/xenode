export class EncryptionRequiredError extends Error {
  constructor(cause?: unknown) {
    super("Encryption failed. The file was not uploaded.");
    this.name = "EncryptionRequiredError";
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Encrypted upload flows must never silently downgrade to plaintext.
 */
export function failClosedOnEncryptionError(error: unknown): never {
  throw new EncryptionRequiredError(error);
}
