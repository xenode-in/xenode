import { describe, expect, it } from "vitest";
import { inspectFileHeader } from "@/lib/file-security/inspection";
import {
  decideFileDisposition,
  isDispositionRendererEnabled,
  DESKTOP_RESOURCE_BUDGET,
} from "@/lib/file-security/policy";
import type {
  BrowserCapabilities,
  RendererFlags,
} from "@/lib/file-security/types";

const capabilities: BrowserCapabilities = {
  messageChannel: true,
  mediaSource: true,
  transferableArrayBuffer: true,
};

const enabled: RendererFlags = {
  global: true,
  pdf: true,
  office: true,
  svg: false,
  html: false,
  image: true,
  media: true,
  archive: false,
  text: true,
  onlyOfficeV2: true,
};

function makeFtyp(
  majorBrand: string,
  compatibleBrands: readonly string[] = [],
): Uint8Array {
  const size = 16 + compatibleBrands.length * 4;
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size);
  const encoder = new TextEncoder();
  bytes.set(encoder.encode("ftyp"), 4);
  bytes.set(encoder.encode(majorBrand), 8);
  compatibleBrands.forEach((brand, index) => {
    bytes.set(encoder.encode(brand), 16 + index * 4);
  });
  return bytes;
}

describe("hostile-file inspection", () => {
  it("recognizes a matching PDF signature", () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n");
    const result = inspectFileHeader(
      bytes,
      "report.pdf",
      "application/pdf",
      bytes.length,
    );
    expect(result.kind).toBe("pdf");
    expect(result.signatureMatched).toBe(true);
  });

  it("blocks MIME confusion", () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n");
    const result = inspectFileHeader(
      bytes,
      "photo.jpg",
      "image/jpeg",
      bytes.length,
    );
    expect(result.signatureMatched).toBe(false);
  });

  it("classifies macro-enabled Office files as active content", () => {
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const result = inspectFileHeader(
      bytes,
      "sheet.xlsm",
      "application/vnd.ms-excel.sheet.macroEnabled.12",
      bytes.length,
    );
    expect(result.kind).toBe("active-document");
    expect(result.macroEnabled).toBe(true);
  });

  it("renders source and XML only as escaped text", () => {
    const xml = inspectFileHeader(
      new TextEncoder().encode("<root><value>safe</value></root>"),
      "data.xml",
      "application/xml",
      31,
    );
    const source = inspectFileHeader(
      new TextEncoder().encode("const value = 1;"),
      "module.ts",
      "text/plain",
      16,
    );
    expect(xml.kind).toBe("text");
    expect(xml.signatureMatched).toBe(true);
    expect(source.kind).toBe("text");
    expect(source.signatureMatched).toBe(true);
  });

  it("keeps HTML, SVG, and Markdown as active download-only content", () => {
    for (const [name, body, mime] of [
      ["page.html", "<script>alert(1)</script>", "text/html"],
      ["image.svg", "<svg><script /></svg>", "image/svg+xml"],
      ["readme.md", "# heading", "text/markdown"],
    ] as const) {
      const inspected = inspectFileHeader(
        new TextEncoder().encode(body),
        name,
        mime,
        body.length,
      );
      expect(inspected.kind).toBe("active-document");
      expect(
        decideFileDisposition(
          inspected,
          "owned",
          "preview",
          enabled,
          capabilities,
          DESKTOP_RESOURCE_BUDGET,
        ).action,
      ).toBe("download-only");
    }
  });

  it("accepts escaped-text candidates but not NUL-bearing content", () => {
    const text = inspectFileHeader(
      new TextEncoder().encode("hello"),
      "notes.txt",
      "text/plain",
      5,
    );
    const binary = inspectFileHeader(
      Uint8Array.from([0x61, 0, 0x62]),
      "notes.txt",
      "text/plain",
      3,
    );
    expect(text.kind).toBe("text");
    expect(text.signatureMatched).toBe(true);
    expect(binary.signatureMatched).toBe(false);
  });
  it("accepts structurally valid MP4, M4V, and MOV brands", () => {
    for (const [brand, name, mime] of [
      ["iso6", "clip.mp4", "video/mp4"],
      ["M4V ", "clip.m4v", "video/x-m4v"],
      ["qt  ", "clip.mov", "video/quicktime"],
    ] as const) {
      const bytes = makeFtyp(brand);
      const result = inspectFileHeader(bytes, name, mime, bytes.length);
      expect(result).toMatchObject({
        kind: "media",
        detectedMime: "video/mp4",
        signatureMatched: true,
      });
    }
  });

  it("accepts an approved compatible video brand", () => {
    const bytes = makeFtyp("zzzz", ["iso6"]);
    const result = inspectFileHeader(
      bytes,
      "clip.mp4",
      "video/mp4",
      bytes.length,
    );
    expect(result).toMatchObject({
      kind: "media",
      detectedMime: "video/mp4",
      signatureMatched: true,
    });
  });

  it("rejects malformed and unknown ISO-BMFF declarations", () => {
    const malformed = makeFtyp("iso6");
    new DataView(malformed.buffer).setUint32(0, malformed.length + 4);
    const unknown = makeFtyp("zzzz");

    expect(
      inspectFileHeader(malformed, "clip.mp4", "video/mp4", malformed.length)
        .signatureMatched,
    ).toBe(false);
    expect(
      inspectFileHeader(unknown, "clip.mp4", "video/mp4", unknown.length)
        .signatureMatched,
    ).toBe(false);
  });
});

describe("preview policy", () => {
  const pdf = inspectFileHeader(
    new TextEncoder().encode("%PDF-1.7\n"),
    "report.pdf",
    "application/pdf",
    9,
  );

  it("fails closed when the global approval is disabled", () => {
    const disposition = decideFileDisposition(
      pdf,
      "owned",
      "preview",
      { ...enabled, global: false },
      capabilities,
      DESKTOP_RESOURCE_BUDGET,
    );
    expect(disposition.action).toBe("download-only");
  });
  it("keeps terminal download states stable when the global flag is off", () => {
    const disabled = { ...enabled, global: false };
    expect(
      isDispositionRendererEnabled(
        { action: "download-only", reason: "Preview system is disabled" },
        disabled,
      ),
    ).toBe(true);
    expect(
      isDispositionRendererEnabled(
        {
          action: "safe-image",
          boundary: "trusted-app-native",
          reason: "approved",
        },
        disabled,
      ),
    ).toBe(false);
  });

  it("never previews versions or bin items", () => {
    expect(
      decideFileDisposition(
        pdf,
        "version",
        "preview",
        enabled,
        capabilities,
        DESKTOP_RESOURCE_BUDGET,
      ).action,
    ).toBe("download-only");
    expect(
      decideFileDisposition(
        pdf,
        "bin",
        "preview",
        enabled,
        capabilities,
        DESKTOP_RESOURCE_BUDGET,
      ).action,
    ).toBe("download-only");
  });

  it("blocks mismatches even when a renderer is approved", () => {
    const mismatch = { ...pdf, signatureMatched: false };
    expect(
      decideFileDisposition(
        mismatch,
        "owned",
        "preview",
        enabled,
        capabilities,
        DESKTOP_RESOURCE_BUDGET,
      ).action,
    ).toBe("blocked-preview");
  });

  it("keeps native formats in the trusted app without iframe primitives", () => {
    const image = inspectFileHeader(
      Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]),
      "photo.jpg",
      "image/jpeg",
      4,
    );
    const disposition = decideFileDisposition(
      image,
      "owned",
      "preview",
      enabled,
      {
        messageChannel: false,
        mediaSource: false,
        transferableArrayBuffer: false,
      },
      DESKTOP_RESOURCE_BUDGET,
    );
    expect(disposition).toMatchObject({
      action: "safe-image",
      boundary: "trusted-app-native",
    });
  });

  it("keeps Office fail-closed without bridge primitives", () => {
    const office = inspectFileHeader(
      Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
      "report.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      4,
    );
    expect(
      decideFileDisposition(
        office,
        "owned",
        "view",
        enabled,
        {
          messageChannel: false,
          mediaSource: false,
          transferableArrayBuffer: false,
        },
        DESKTOP_RESOURCE_BUDGET,
      ).action,
    ).toBe("download-only");
  });

  it("does not misclassify HEIC or unknown BMFF as video", () => {
    const heic = new Uint8Array(16);
    heic.set(new TextEncoder().encode("ftyp"), 4);
    heic.set(new TextEncoder().encode("heic"), 8);
    const result = inspectFileHeader(
      heic,
      "photo.heic",
      "image/heic",
      heic.length,
    );
    expect(result.kind).toBe("unknown");
    expect(result.signatureMatched).toBe(false);
  });

  it("rejects raster dimensions above the resource budget", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const width = 20_000;
    const height = 20_000;
    png[16] = (width >>> 24) & 0xff;
    png[17] = (width >>> 16) & 0xff;
    png[18] = (width >>> 8) & 0xff;
    png[19] = width & 0xff;
    png[20] = (height >>> 24) & 0xff;
    png[21] = (height >>> 16) & 0xff;
    png[22] = (height >>> 8) & 0xff;
    png[23] = height & 0xff;
    const image = inspectFileHeader(png, "large.png", "image/png", png.length);
    expect(
      decideFileDisposition(
        image,
        "owned",
        "preview",
        enabled,
        capabilities,
        DESKTOP_RESOURCE_BUDGET,
      ).action,
    ).toBe("download-only");
  });
});
