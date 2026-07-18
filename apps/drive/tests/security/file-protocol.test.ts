import { describe, expect, it } from "vitest";
import {
  isLegalTransition,
  runtimeEnvelopeSchema,
} from "@/lib/file-security/protocol";

const valid = {
  protocolVersion: 1,
  sessionId: "d39566d4-14f9-4a11-854c-5b4fcd3b303f",
  nonce: "0123456789abcdef0123456789abcdef",
  requestId: 1,
  type: "INIT",
  payload: {},
};

describe("isolated runtime protocol", () => {
  it("accepts the strict protocol envelope", () => {
    expect(runtimeEnvelopeSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unknown fields", () => {
    expect(
      runtimeEnvelopeSchema.safeParse({ ...valid, accessToken: "secret" }).success,
    ).toBe(false);
  });

  it("rejects oversized declared buffers", () => {
    expect(
      runtimeEnvelopeSchema.safeParse({
        ...valid,
        byteLength: 201 * 1024 * 1024,
      }).success,
    ).toBe(false);
  });

  it("allows only explicit lifecycle transitions", () => {
    expect(isLegalTransition("CREATED", "BOOTSTRAPPED")).toBe(true);
    expect(isLegalTransition("CREATED", "OPEN")).toBe(false);
    expect(isLegalTransition("OPEN", "SAVING")).toBe(true);
    expect(isLegalTransition("CLOSED", "READY")).toBe(false);
  });
});
