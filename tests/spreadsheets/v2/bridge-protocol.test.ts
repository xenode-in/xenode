import { describe, expect, it } from "vitest";
import {
  BRIDGE_CHANNEL,
  BRIDGE_PROTOCOL_VERSION,
  extractBuffer,
  validateEnvelope,
} from "@/lib/spreadsheets/v2/bridge/protocol";

const NONCE = "session-nonce-123";

function parentEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    channel: BRIDGE_CHANNEL,
    v: BRIDGE_PROTOCOL_VERSION,
    nonce: NONCE,
    type: "INIT",
    mode: "edit",
    theme: "light",
    extension: "xlsx",
    ...overrides,
  };
}

function frameEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    channel: BRIDGE_CHANNEL,
    v: BRIDGE_PROTOCOL_VERSION,
    nonce: NONCE,
    type: "READY",
    ...overrides,
  };
}

describe("bridge protocol validation", () => {
  const parentOpts = { expect: "parent" as const, nonce: NONCE, maxPayloadBytes: 1024 };
  const frameOpts = { expect: "frame" as const, nonce: NONCE, maxPayloadBytes: 1024 };

  it("accepts a well-formed parent message when expecting parent", () => {
    const result = validateEnvelope(parentEnvelope(), parentOpts);
    expect(result.ok).toBe(true);
  });

  it("accepts a well-formed frame message when expecting frame", () => {
    const result = validateEnvelope(frameEnvelope(), frameOpts);
    expect(result.ok).toBe(true);
  });

  it("rejects a foreign channel", () => {
    const result = validateEnvelope(parentEnvelope({ channel: "evil" }), parentOpts);
    expect(result).toMatchObject({ ok: false, reason: "wrong_channel" });
  });

  it("rejects a version mismatch (fails closed on drift)", () => {
    const result = validateEnvelope(parentEnvelope({ v: 999 }), parentOpts);
    expect(result).toMatchObject({ ok: false, reason: "version_mismatch" });
  });

  it("rejects a stale/foreign nonce", () => {
    const result = validateEnvelope(parentEnvelope({ nonce: "other" }), parentOpts);
    expect(result).toMatchObject({ ok: false, reason: "nonce_mismatch" });
  });

  it("rejects a frame-only type when a parent expects parent types", () => {
    const result = validateEnvelope(frameEnvelope({ type: "SAVE_BYTES" }), parentOpts);
    expect(result).toMatchObject({ ok: false, reason: "unexpected_type" });
  });

  it("rejects a parent-only type when a frame expects frame types", () => {
    const result = validateEnvelope(parentEnvelope({ type: "OPEN_EDITOR_BIN" }), frameOpts);
    expect(result).toMatchObject({ ok: false, reason: "unexpected_type" });
  });

  it("rejects an oversized transferred payload", () => {
    const bin = new ArrayBuffer(2048);
    const result = validateEnvelope(
      frameEnvelope({ type: "SAVE_BYTES", bin }),
      frameOpts,
    );
    expect(result).toMatchObject({ ok: false, reason: "payload_too_large" });
  });

  it("accepts an in-limit transferred payload", () => {
    const bin = new ArrayBuffer(512);
    const result = validateEnvelope(
      frameEnvelope({ type: "SAVE_BYTES", bin }),
      frameOpts,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects non-object data", () => {
    expect(validateEnvelope(null, parentOpts)).toMatchObject({ ok: false });
    expect(validateEnvelope("nope", parentOpts)).toMatchObject({ ok: false });
  });

  it("extractBuffer only returns real ArrayBuffers", () => {
    expect(extractBuffer({ bin: new ArrayBuffer(4) })).toBeInstanceOf(ArrayBuffer);
    expect(extractBuffer({ bin: "not-a-buffer" })).toBeNull();
    expect(extractBuffer({})).toBeNull();
  });
});
