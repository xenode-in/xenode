import { describe, expect, it } from "vitest";
import { uniqueName } from "@/lib/uploads/uniqueName";

describe("uniqueName", () => {
  it("keeps free names and numbers taken ones before the extension, case-insensitively", () => {
    expect(uniqueName("report.pdf", new Set())).toBe("report.pdf");
    expect(uniqueName("Report.PDF", new Set(["report.pdf"]))).toBe("Report (1).PDF");
    expect(uniqueName("report.pdf", new Set(["report.pdf", "report (1).pdf"]))).toBe("report (2).pdf");
    expect(uniqueName("archive.tar.gz", new Set(["archive.tar.gz"]))).toBe("archive.tar (1).gz");
    expect(uniqueName("Makefile", new Set(["makefile"]))).toBe("Makefile (1)");
    expect(uniqueName(".env", new Set([".env"]))).toBe(".env (1)");
  });
});
