import type {
  BrowserCapabilities,
  InspectedFile,
  PreviewDisposition,
  PreviewIntent,
  PreviewSourceContext,
  RendererFlags,
  ResourceBudget,
} from "./types";

export const DESKTOP_RESOURCE_BUDGET: ResourceBudget = {
  maxInputBytes: 50 * 1024 * 1024,
  maxOutputBytes: 200 * 1024 * 1024,
  maxImagePixels: 40_000_000,
  maxImageDimension: 16_384,
  maxAnimatedFrames: 1_000,
  maxPdfPages: 250,
  maxArchiveEntries: 5_000,
  maxExpandedBytes: 512 * 1024 * 1024,
  maxCompressionRatio: 100,
  parserTimeoutMs: 15_000,
  sessionTimeoutMs: 60_000,
};

export const CONSTRAINED_RESOURCE_BUDGET: ResourceBudget = {
  ...DESKTOP_RESOURCE_BUDGET,
  maxInputBytes: 25 * 1024 * 1024,
  maxOutputBytes: 80 * 1024 * 1024,
  maxImagePixels: 20_000_000,
  maxPdfPages: 100,
  maxExpandedBytes: 256 * 1024 * 1024,
};

export function decideFileDisposition(
  file: InspectedFile,
  source: PreviewSourceContext,
  intent: PreviewIntent,
  flags: RendererFlags,
  capabilities: BrowserCapabilities,
  budget: ResourceBudget,
): PreviewDisposition {
  if (!flags.global) {
    return { action: "download-only", reason: "Preview system is disabled" };
  }
  if (source === "version" || source === "bin") {
    return {
      action: "download-only",
      reason: "Versions and deleted files are never previewed",
    };
  }
  if (file.size > budget.maxInputBytes) {
    return {
      action: "download-only",
      reason: "File exceeds the preview resource budget",
    };
  }
  if (file.malformed || file.ambiguous || !file.signatureMatched) {
    return {
      action: "blocked-preview",
      reason: "File content does not safely match its declared type",
    };
  }
  if (file.kind === "image" && file.imageMetrics) {
    const { width, height, animatedFrames } = file.imageMetrics;
    if (
      (width !== null && width > budget.maxImageDimension) ||
      (height !== null && height > budget.maxImageDimension) ||
      (width !== null &&
        height !== null &&
        width * height > budget.maxImagePixels) ||
      (animatedFrames !== null && animatedFrames > budget.maxAnimatedFrames)
    ) {
      return {
        action: "download-only",
        reason: "Image exceeds the preview resource budget",
      };
    }
  }
  if (
    file.macroEnabled ||
    file.kind === "active-document" ||
    file.kind === "executable"
  ) {
    return {
      action: "download-only",
      reason: "Active content is not previewed",
    };
  }

  switch (file.kind) {
    case "image":
      return flags.image
        ? {
            action: "safe-image",
            boundary: "trusted-app-native",
            reason:
              "Verified raster image approved for native browser decoding",
          }
        : { action: "download-only", reason: "Image renderer disabled" };
    case "pdf":
      return flags.pdf
        ? {
            action: "pdf-canvas",
            boundary: "trusted-app-worker-canvas",
            reason:
              "Verified PDF approved for PDF.js worker and canvas rendering",
          }
        : { action: "download-only", reason: "PDF renderer disabled" };
    case "media":
      return flags.media
        ? {
            action: "safe-media",
            boundary: "trusted-app-native",
            reason:
              "Verified media approved for user-initiated native playback",
          }
        : { action: "download-only", reason: "Media renderer unavailable" };
    case "text":
      return flags.text
        ? {
            action: "safe-text",
            boundary: "trusted-app-native",
            reason: "Verified text approved for escaped rendering",
          }
        : { action: "download-only", reason: "Text renderer disabled" };
    case "office":
      return flags.office &&
        flags.onlyOfficeV2 &&
        intent !== "thumbnail" &&
        capabilities.messageChannel &&
        capabilities.transferableArrayBuffer
        ? {
            action: "office-view-edit",
            boundary: "isolated-editor",
            reason: "Office editor approved for the isolated editor origin",
          }
        : { action: "download-only", reason: "Office editor disabled" };
    default:
      return {
        action: "download-only",
        reason: "This file type is not previewed",
      };
  }
}

export function isDispositionRendererEnabled(
  disposition: PreviewDisposition,
  flags: RendererFlags,
): boolean {
  if (
    disposition.action === "download-only" ||
    disposition.action === "blocked-preview"
  ) {
    return true;
  }
  if (!flags.global) return false;

  switch (disposition.action) {
    case "safe-image":
      return flags.image;
    case "safe-media":
      return flags.media;
    case "pdf-canvas":
      return flags.pdf;
    case "safe-text":
      return flags.text;
    case "office-view-edit":
      return flags.office && flags.onlyOfficeV2;
  }
}
