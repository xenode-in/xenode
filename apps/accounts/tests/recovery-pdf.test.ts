import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createRecoveryKitPdf } from "../lib/recovery-pdf";

describe("recovery kit PDF", () => {
  it("creates a downloadable one-page PDF without requiring a print dialog", async () => {
    const bytes = await createRecoveryKitPdf({
      accountLabel: "account@example.test",
      generatedDate: "July 28, 2026",
      recoveryPhrase:
        "abandon ability able about above absent absorb abstract absurd abuse access accident",
    });
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBe(1);
    expect(document.getTitle()).toBe("Xenode Recovery Kit");
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
  });

  it("rejects malformed recovery phrases", async () => {
    await expect(
      createRecoveryKitPdf({
        accountLabel: "account@example.test",
        generatedDate: "July 28, 2026",
        recoveryPhrase: "too few words",
      }),
    ).rejects.toThrow("exactly 12 words");
  });
});
