import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { driveContentSecurityPolicy } from "@/lib/security/csp";
const nonce = Buffer.alloc(32, 7).toString("base64");
afterEach(() => vi.unstubAllEnvs());
describe("enforced Drive page CSP", () => {
  it("binds a fresh nonce to SSR, overwrites spoofed headers and prevents cached reuse", () => {
    const request = () => new NextRequest("https://xenode.in/privacy", { headers: { host: "xenode.in", "x-nonce": "attacker", "content-security-policy": "script-src *" } });
    const a = proxy(request()), b = proxy(request());
    const policy = a.headers.get("content-security-policy")!;
    expect(policy).toContain("'strict-dynamic'"); expect(policy).not.toContain("attacker");
    expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    expect(a.headers.get("x-middleware-request-x-nonce")).not.toBe("attacker");
    expect(b.headers.get("content-security-policy")).not.toBe(policy);
    expect(a.headers.get("cache-control")).toContain("no-store");
    expect(a.headers.get("content-security-policy-report-only")).toBeNull();
  });
  it("allows exact configured service/storage origins and payment frames only on checkout", () => {
    vi.stubEnv("ACCOUNTS_ORIGIN", "https://accounts.csp.test");
    vi.stubEnv("NEXT_PUBLIC_REALTIME_ORIGIN", "https://socket.csp.test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "fixture-key");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://analytics.csp.test");
    vi.stubEnv("S3_US_ENDPOINT", "https://account.us.r2.cloudflarestorage.com");
    const policy = driveContentSecurityPolicy(nonce, false);
    expect(policy).toContain("wss://socket.csp.test"); expect(policy).toContain("https://analytics.csp.test");
    expect(policy).toContain("https://account.us.r2.cloudflarestorage.com");
    expect(policy).not.toContain("razorpay");
    expect(driveContentSecurityPolicy(nonce, true)).toContain("frame-src https://accounts.csp.test");
    expect(driveContentSecurityPolicy(nonce, true)).toContain("https://checkout.razorpay.com");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://analytics.csp.test; script-src *");
    expect(() => driveContentSecurityPolicy(nonce, true)).toThrow("exact");
  });
  it("restricts production scripts without breaking WebAssembly and dev hot reload", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ACCOUNTS_ORIGIN", "https://accounts.csp.test");
    vi.stubEnv("NEXT_PUBLIC_DRIVE_ORIGIN", "https://drive.csp.test");
    vi.stubEnv("NEXT_PUBLIC_REALTIME_ORIGIN", "https://drive.csp.test");
    const policy = driveContentSecurityPolicy(nonce, false);
    expect(policy).toContain("'wasm-unsafe-eval'"); expect(policy).not.toContain("'unsafe-eval'");
    expect(policy.split("script-src ")[1].split(";")[0]).not.toContain("'unsafe-inline'");
    expect(policy).toContain("script-src-attr 'none'"); expect(policy).toContain("object-src 'none'");
    vi.stubEnv("NODE_ENV", "development"); expect(driveContentSecurityPolicy(nonce, false)).toContain("'unsafe-eval'");
    expect(() => driveContentSecurityPolicy("forged", false)).toThrow("nonce");
  });
  it("preserves separate logout CSP and API origin/auth guards", () => {
    expect(proxy(new NextRequest("https://xenode.in/auth/logout/cleanup", { headers: { host: "xenode.in" } })).headers.get("content-security-policy")).toBeNull();
    vi.stubEnv("DRIVE_ORIGIN", "https://xenode.in");
    expect(proxy(new NextRequest("https://xenode.in/api/me", { headers: { host: "xenode.in", origin: "https://evil.test" } })).status).toBe(403);
  });
});
