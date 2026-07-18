import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyRuntimeKills,
  getEnvironmentRendererFlags,
} from "@/lib/file-security/flags";

afterEach(() => vi.unstubAllEnvs());

describe("renderer feature flags", () => {
  it("defaults every renderer to disabled", () => {
    const flags = getEnvironmentRendererFlags();
    expect(Object.values(flags).every((value) => value === false)).toBe(true);
  });

  it("requires global and renderer deployment approval", () => {
    vi.stubEnv("SAFE_PREVIEW_GLOBAL_ENABLED", "true");
    vi.stubEnv("SAFE_PREVIEW_PDF_ENABLED", "true");
    const flags = getEnvironmentRendererFlags();
    expect(flags.global).toBe(true);
    expect(flags.pdf).toBe(true);
    expect(flags.image).toBe(false);
  });

  it("allows runtime state only to disable deployment approvals", () => {
    vi.stubEnv("SAFE_PREVIEW_GLOBAL_ENABLED", "true");
    vi.stubEnv("SAFE_PREVIEW_PDF_ENABLED", "true");
    const environment = getEnvironmentRendererFlags();
    expect(applyRuntimeKills(environment, { pdf: true }).pdf).toBe(false);
    expect(applyRuntimeKills(environment, { image: false }).image).toBe(false);
    expect(applyRuntimeKills(environment, { global: true }).global).toBe(false);
  });
});
