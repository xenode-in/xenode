import { describe, expect, it } from "vitest";

import {
  EncryptionRequiredError,
  failClosedOnEncryptionError,
} from "@/lib/crypto/encryptionPolicy";

describe("encrypted upload policy", () => {
  it("stops the upload instead of downgrading to plaintext", () => {
    const cause = new Error("crypto unavailable");

    expect(() => failClosedOnEncryptionError(cause)).toThrow(
      EncryptionRequiredError,
    );
    expect(() => failClosedOnEncryptionError(cause)).toThrow(
      "Encryption failed. The file was not uploaded.",
    );
  });
});
