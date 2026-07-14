import type { FileKind, InspectedFile } from "./types";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);
const MEDIA_EXTENSIONS = new Set([
  "mp4",
  "webm",
  "ogg",
  "ogv",
  "oga",
  "wav",
  "mp3",
  "m4v",
  "mov",
]);
const TEXT_EXTENSIONS = new Set([
  "txt",
  "log",
  "json",
  "csv",
  "xml",
  "yaml",
  "yml",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "py",
  "go",
  "rs",
  "java",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "sql",
]);

const ISO_BMFF_IMAGE_BRANDS = new Set(["avif", "avis"]);
const ISO_BMFF_HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "mif1",
  "msf1",
]);
const ISO_BMFF_AUDIO_BRANDS = new Set(["M4A ", "M4B ", "M4P "]);
const ISO_BMFF_VIDEO_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "iso7",
  "iso8",
  "iso9",
  "mp41",
  "mp42",
  "avc1",
  "av01",
  "dash",
  "M4V ",
  "F4V ",
  "MSNV",
  "mp71",
  "qt  ",
  "cmfc",
  "cmfs",
  "cmfv",
]);
const OFFICE_EXTENSIONS = new Set([
  "docx",
  "xlsx",
  "pptx",
  "odt",
  "ods",
  "odp",
]);
const MACRO_EXTENSIONS = new Set([
  "docm",
  "xlsm",
  "pptm",
  "dotm",
  "xltm",
  "potm",
]);
const ACTIVE_EXTENSIONS = new Set([
  "html",
  "htm",
  "xhtml",
  "mhtml",
  "svg",
  "md",
  "markdown",
]);
const ARCHIVE_EXTENSIONS = new Set([
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "bz2",
  "xz",
]);
const EXECUTABLE_EXTENSIONS = new Set([
  "exe",
  "dll",
  "msi",
  "com",
  "bat",
  "cmd",
  "ps1",
  "sh",
  "app",
  "dmg",
  "elf",
]);

function extensionOf(name: string): string | null {
  const nameOnly = name.replaceAll("\\", "/").split("/").pop() ?? "";
  const index = nameOnly.lastIndexOf(".");
  return index > 0 ? nameOnly.slice(index + 1).toLowerCase() : null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}
function readU24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function inspectImageMetrics(
  bytes: Uint8Array,
  mime: string | null,
  complete: boolean,
): {
  width: number | null;
  height: number | null;
  animatedFrames: number | null;
} | null {
  if (mime === "image/png" && bytes.length >= 24) {
    return {
      width: readU32BE(bytes, 16),
      height: readU32BE(bytes, 20),
      animatedFrames: null,
    };
  }
  if (mime === "image/webp" && bytes.length >= 25) {
    const chunkType = ascii(bytes, 12, 4);
    if (chunkType === "VP8X" && bytes.length >= 30) {
      return {
        width: readU24LE(bytes, 24) + 1,
        height: readU24LE(bytes, 27) + 1,
        animatedFrames: null,
      };
    }
    if (
      chunkType === "VP8 " &&
      bytes.length >= 30 &&
      starts(bytes.slice(23), [0x9d, 0x01, 0x2a])
    ) {
      return {
        width: readU16LE(bytes, 26) & 0x3fff,
        height: readU16LE(bytes, 28) & 0x3fff,
        animatedFrames: null,
      };
    }
    if (chunkType === "VP8L" && bytes[20] === 0x2f) {
      const bits =
        bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
        animatedFrames: null,
      };
    }
    return { width: null, height: null, animatedFrames: null };
  }
  if (mime === "image/gif" && bytes.length >= 10) {
    let frames: number | null = null;
    if (complete) {
      frames = 0;
      for (const byte of bytes) {
        if (byte === 0x2c) frames += 1;
      }
    }
    return {
      width: readU16LE(bytes, 6),
      height: readU16LE(bytes, 8),
      animatedFrames: frames,
    };
  }
  if (mime === "image/jpeg") {
    let offset = 2;
    const sofMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
      0xcf,
    ]);
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (sofMarkers.has(marker)) {
        return {
          width: readU16BE(bytes, offset + 7),
          height: readU16BE(bytes, offset + 5),
          animatedFrames: null,
        };
      }
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const segmentLength = readU16BE(bytes, offset + 2);
      if (segmentLength < 2) break;
      offset += segmentLength + 2;
    }
  }
  return mime?.startsWith("image/")
    ? { width: null, height: null, animatedFrames: null }
    : null;
}

function inspectIsoBmff(
  bytes: Uint8Array,
): { kind: FileKind; mime: string | null } | null {
  if (bytes.length < 16 || ascii(bytes, 4, 4) !== "ftyp") return null;

  const declaredSize = readU32BE(bytes, 0);
  const boxEnd = declaredSize === 0 ? bytes.length : declaredSize;
  if (boxEnd < 16 || boxEnd > bytes.length || (boxEnd - 16) % 4 !== 0) {
    return { kind: "unknown", mime: null };
  }

  const majorBrand = ascii(bytes, 8, 4);
  const compatibleBrands: string[] = [];
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    compatibleBrands.push(ascii(bytes, offset, 4));
  }
  const brands = [majorBrand, ...compatibleBrands];

  if (ISO_BMFF_IMAGE_BRANDS.has(majorBrand)) {
    return { kind: "image", mime: "image/avif" };
  }
  if (ISO_BMFF_HEIF_BRANDS.has(majorBrand)) {
    return { kind: "unknown", mime: "image/heif" };
  }
  if (ISO_BMFF_AUDIO_BRANDS.has(majorBrand)) {
    return { kind: "media", mime: "audio/mp4" };
  }
  if (ISO_BMFF_VIDEO_BRANDS.has(majorBrand)) {
    return { kind: "media", mime: "video/mp4" };
  }

  if (brands.some((brand) => ISO_BMFF_IMAGE_BRANDS.has(brand))) {
    return { kind: "image", mime: "image/avif" };
  }
  if (brands.some((brand) => ISO_BMFF_HEIF_BRANDS.has(brand))) {
    return { kind: "unknown", mime: "image/heif" };
  }
  if (brands.some((brand) => ISO_BMFF_AUDIO_BRANDS.has(brand))) {
    return { kind: "media", mime: "audio/mp4" };
  }
  if (brands.some((brand) => ISO_BMFF_VIDEO_BRANDS.has(brand))) {
    return { kind: "media", mime: "video/mp4" };
  }

  return { kind: "unknown", mime: null };
}

function starts(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function hasNul(bytes: Uint8Array): boolean {
  return bytes.some((value) => value === 0);
}

function detect(bytes: Uint8Array): { kind: FileKind; mime: string | null } {
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return { kind: "pdf", mime: "application/pdf" };
  if (starts(bytes, [0xff, 0xd8, 0xff]))
    return { kind: "image", mime: "image/jpeg" };
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { kind: "image", mime: "image/png" };
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")
    return { kind: "image", mime: "image/gif" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP")
    return { kind: "image", mime: "image/webp" };
  const isoBmff = inspectIsoBmff(bytes);
  if (isoBmff) return isoBmff;
  if (starts(bytes, [0x1a, 0x45, 0xdf, 0xa3]))
    return { kind: "media", mime: "video/webm" };
  if (ascii(bytes, 0, 4) === "OggS")
    return { kind: "media", mime: "application/ogg" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE")
    return { kind: "media", mime: "audio/wav" };
  if (
    ascii(bytes, 0, 3) === "ID3" ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  )
    return { kind: "media", mime: "audio/mpeg" };
  if (
    starts(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    starts(bytes, [0x50, 0x4b, 0x05, 0x06])
  )
    return { kind: "archive", mime: "application/zip" };
  if (starts(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    return { kind: "active-document", mime: "application/x-ole-storage" };
  if (starts(bytes, [0x4d, 0x5a]) || starts(bytes, [0x7f, 0x45, 0x4c, 0x46]))
    return { kind: "executable", mime: "application/x-executable" };
  return { kind: "unknown", mime: null };
}

export function inspectFileHeader(
  bytes: Uint8Array,
  name: string,
  suppliedMime: string | null,
  size: number,
): InspectedFile {
  const extension = extensionOf(name);
  const detected = detect(bytes);
  const macroEnabled = extension !== null && MACRO_EXTENSIONS.has(extension);

  let kind = detected.kind;
  if (
    macroEnabled ||
    (extension !== null && ACTIVE_EXTENSIONS.has(extension))
  ) {
    kind = "active-document";
  } else if (extension !== null && EXECUTABLE_EXTENSIONS.has(extension)) {
    kind = "executable";
  } else if (
    extension !== null &&
    OFFICE_EXTENSIONS.has(extension) &&
    detected.mime === "application/zip"
  ) {
    kind = "office";
  } else if (
    extension !== null &&
    TEXT_EXTENSIONS.has(extension) &&
    !hasNul(bytes) &&
    detected.kind === "unknown"
  ) {
    kind = "text";
  } else if (extension !== null && ARCHIVE_EXTENSIONS.has(extension)) {
    kind = "archive";
  }

  const extensionMatches =
    extension === null ||
    (kind === "image" && IMAGE_EXTENSIONS.has(extension)) ||
    (kind === "media" && MEDIA_EXTENSIONS.has(extension)) ||
    (kind === "text" && TEXT_EXTENSIONS.has(extension)) ||
    (kind === "office" && OFFICE_EXTENSIONS.has(extension)) ||
    (kind === "pdf" && extension === "pdf") ||
    kind === "active-document" ||
    kind === "archive" ||
    kind === "executable";

  const normalizedMime =
    suppliedMime?.split(";")[0].trim().toLowerCase() || null;
  const mimeMatches =
    normalizedMime === null ||
    normalizedMime === "application/octet-stream" ||
    detected.mime === null ||
    normalizedMime === detected.mime ||
    (kind === "office" &&
      (normalizedMime.includes("officedocument") ||
        normalizedMime.includes("opendocument"))) ||
    (kind === "media" &&
      (normalizedMime.startsWith("audio/") ||
        normalizedMime.startsWith("video/")));

  return {
    kind,
    imageMetrics: inspectImageMetrics(
      bytes,
      detected.mime,
      bytes.length === size,
    ),
    detectedMime: detected.mime,
    suppliedMime: normalizedMime,
    extension,
    size,
    signatureMatched: extensionMatches && mimeMatches && kind !== "unknown",
    macroEnabled,
    malformed: size < bytes.length || (kind !== "text" && bytes.length < 3),
    ambiguous: detected.kind === "executable" && kind !== "executable",
  };
}
