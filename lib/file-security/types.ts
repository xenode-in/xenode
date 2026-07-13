export const RENDERER_KEYS = [
  "pdf",
  "office",
  "svg",
  "html",
  "image",
  "media",
  "archive",
  "text",
  "onlyOfficeV2",
] as const;

export type RendererKey = (typeof RENDERER_KEYS)[number];
export type RendererFlags = Record<RendererKey, boolean> & { global: boolean };

export type PreviewSourceContext =
  | "owned"
  | "public-share"
  | "album"
  | "organization-share"
  | "version"
  | "bin"
  | "upload"
  | "avatar"
  | "organization-logo";

export type PreviewIntent = "preview" | "view" | "edit" | "thumbnail";

export interface ImageMetrics {
  width: number | null;
  height: number | null;
  animatedFrames: number | null;
}

export type FileKind =
  | "image"
  | "pdf"
  | "media"
  | "text"
  | "office"
  | "active-document"
  | "archive"
  | "executable"
  | "unknown";

export interface InspectedFile {
  kind: FileKind;
  imageMetrics: ImageMetrics | null;
  detectedMime: string | null;
  suppliedMime: string | null;
  extension: string | null;
  size: number;
  signatureMatched: boolean;
  macroEnabled: boolean;
  malformed: boolean;
  ambiguous: boolean;
}

export type PreviewDisposition =
  | {
      action:
        | "safe-image"
        | "pdf-canvas"
        | "safe-media"
        | "safe-text"
        | "office-view-edit";
      boundary:
        | "trusted-app-native"
        | "trusted-app-worker-canvas"
        | "isolated-editor";
      reason: string;
    }
  | { action: "download-only" | "blocked-preview"; reason: string };

export interface BrowserCapabilities {
  messageChannel: boolean;
  mediaSource: boolean;
  transferableArrayBuffer: boolean;
}

export interface ResourceBudget {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxImagePixels: number;
  maxImageDimension: number;
  maxAnimatedFrames: number;
  maxPdfPages: number;
  maxArchiveEntries: number;
  maxExpandedBytes: number;
  maxCompressionRatio: number;
  parserTimeoutMs: number;
  sessionTimeoutMs: number;
}

export interface RuntimeEnvelope<T = unknown> {
  protocolVersion: 1;
  sessionId: string;
  nonce: string;
  requestId: number;
  type: string;
  payload: T;
}
