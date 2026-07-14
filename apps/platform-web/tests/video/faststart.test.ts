import { describe, expect, it } from "vitest";
import { __faststartTestUtils } from "@/lib/video/faststart";

const utils = __faststartTestUtils;

function box(type: string, offset: number, size: number) {
  return { type, offset, size };
}

describe("MP4 fast-start structural validation", () => {
  it("accepts one ftyp, one mdat, and exactly one moov", () => {
    expect(utils).toBeDefined();
    expect(
      utils!.structuralBoxError([
        box("ftyp", 0, 24),
        box("mdat", 24, 100),
        box("moov", 124, 40),
      ]),
    ).toBeNull();
  });

  it("rejects duplicate ftyp boxes instead of dropping bytes", () => {
    expect(
      utils!.structuralBoxError([
        box("ftyp", 0, 24),
        box("ftyp", 24, 24),
        box("mdat", 48, 100),
        box("moov", 148, 40),
      ]),
    ).toContain("duplicate ftyp");
  });

  it("rejects duplicate or missing moov boxes", () => {
    expect(
      utils!.structuralBoxError([
        box("ftyp", 0, 24),
        box("mdat", 24, 100),
        box("moov", 124, 40),
        box("moov", 164, 40),
      ]),
    ).toContain("exactly one moov");

    expect(
      utils!.structuralBoxError([
        box("ftyp", 0, 24),
        box("mdat", 24, 100),
      ]),
    ).toContain("exactly one moov");
  });
});
