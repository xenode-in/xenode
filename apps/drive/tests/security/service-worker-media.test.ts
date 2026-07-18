import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function loadWorkerFunction<T>(name: string): T {
  const listeners = new Map<string, (event: unknown) => void>();
  const context = createContext({
    self: {
      addEventListener(type: string, listener: (event: unknown) => void) {
        listeners.set(type, listener);
      },
      skipWaiting() {},
      clients: { claim: async () => undefined },
    },
    URL,
    ArrayBuffer,
    Uint8Array,
    atob,
  });
  runInContext(read("public/sw.js"), context);
  return runInContext(name, context) as T;
}

describe("hardened E2EE media service worker", () => {
  it("parses bounded single byte ranges", () => {
    const parseRange =
      loadWorkerFunction<
        (
          value: string | null,
          size: number,
        ) => { start: number; end: number; partial: boolean } | null
      >("parseRange");

    expect(parseRange("bytes=100-199", 1_000)).toMatchObject({
      start: 100,
      end: 199,
      partial: true,
    });
    expect(parseRange("bytes=-100", 1_000)).toMatchObject({
      start: 900,
      end: 999,
      partial: true,
    });
    expect(parseRange("bytes=0-", 20 * 1024 * 1024)?.end).toBe(
      8 * 1024 * 1024 - 1,
    );
    expect(parseRange("bytes=0-1,4-5", 1_000)).toBeNull();
    expect(parseRange("bytes=1000-", 1_000)).toBeNull();
  });

  it("validates encryption metadata and approved media types", () => {
    const validate = loadWorkerFunction<
      (
        data: Record<string, unknown>,
        clientId: string,
      ) => { contentType: string; plainSize: number }
    >("validateRegistration");
    const iv = Buffer.alloc(12).toString("base64");
    const data = {
      type: "REGISTER_MEDIA_SESSION",
      token: "a".repeat(43),
      rawDEK: new ArrayBuffer(32),
      chunkSize: 1024,
      chunkCount: 2,
      cipherSize: 1556,
      urls: ["https://storage.example/0", "https://storage.example/1"],
      chunkIvs: [iv, iv],
      contentType: "video/mp4",
    };

    expect(validate(data, "client-1")).toEqual({
      contentType: "video/mp4",
      plainSize: 1524,
    });
    expect(() =>
      validate({ ...data, contentType: "text/html" }, "client-1"),
    ).toThrow("Unsupported media type");
    expect(() =>
      validate({ ...data, initialCiphertext: new ArrayBuffer(1) }, "client-1"),
    ).toThrow("Seeded media chunk has an invalid size");
    expect(() => validate(data, "")).toThrow("Invalid encrypted media session");
  });

  it("keeps plaintext ephemeral, bounded, and bound to the registering tab", () => {
    const worker = read("public/sw.js");
    const client = read("lib/media/serviceWorkerMedia.ts");
    const dialog = read("components/dashboard/FilePreviewDialog.tsx");

    expect(worker).toContain("const MAX_CACHED_CHUNKS = 8");
    expect(worker).toContain("requestClientId !== session.clientId");
    expect(worker).toContain('credentials: "omit"');
    expect(worker).toContain('"Cache-Control": "no-store');
    expect(worker).not.toContain("caches.open");
    expect(worker).not.toContain("/sw/objects/");
    expect(client).toContain("crypto.getRandomValues(new Uint8Array(32))");
    expect(client).toContain("CLOSE_MEDIA_SESSION");
    expect(worker).toContain("data.initialCiphertext");
    expect(worker).toContain("session.chunkCache.set(");
    expect(client).toContain("initialCiphertext");
    expect(dialog).toContain("mediaInspectionRef");
    expect(dialog).toContain("initialCiphertext: firstCiphertext");

    const policyGate = dialog.indexOf(
      'approved.disposition.action !== "safe-media"',
    );
    const registration = dialog.indexOf(
      "const mediaSession = await createServiceWorkerMediaSession",
    );
    expect(policyGate).toBeGreaterThan(-1);
    expect(registration).toBeGreaterThan(policyGate);
  });
});
