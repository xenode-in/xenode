import { describe, expect, it } from "vitest";
import { fileTypeLabel } from "@/lib/file-icons";

describe("fileTypeLabel", () => {
  it("prefers the decrypted name's extension, else a readable MIME label", () => {
    expect(fileTypeLabel("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Notes.DOCX")).toBe("docx");
    expect(fileTypeLabel("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("docx");
    expect(fileTypeLabel("application/octet-stream", null)).toBe("file");
    expect(fileTypeLabel("application/vnd.android.package-archive")).toBe("android");
    expect(fileTypeLabel("image/jpeg", "photo")).toBe("jpeg");
  });
});
