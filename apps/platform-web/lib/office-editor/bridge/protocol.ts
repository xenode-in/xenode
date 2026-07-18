/**
 * lib/office-editor/bridge/protocol.ts
 *
 * The single source of truth for the Xenode <-> ONLYOFFICE iframe protocol.
 * Both the parent app and the in-iframe host import this file so the message
 * shapes can never drift. The protocol is small, versioned, and closed: only
 * the message types enumerated here are ever accepted, and every field is
 * validated on receipt (see `validateEnvelope`).
 *
 * Design rules:
 *  - Binary payloads travel as transferable `ArrayBuffer`s, never cloned.
 *  - Every message carries the protocol version and the per-session nonce.
 *  - Nothing document-derived (file names, cell values, formulas) is placed in
 *    a message except the opaque binary buffers themselves and the minimal
 *    A1-range selection needed for comments.
 */

export const BRIDGE_PROTOCOL_VERSION = 2;

/** Marks every Xenode bridge envelope so foreign postMessages are ignored. */
export const BRIDGE_CHANNEL = "xenode.sheets.v2" as const;

export type EditorMode = "edit" | "view";
export type EditorTheme = "light" | "dark";
export type SavedDocumentFormat = "editor-bin" | "xlsx";

/** Parent -> frame message types. */
export type ParentMessageType =
  | "INIT"
  | "OPEN_EDITOR_BIN"
  | "SET_MODE"
  | "SET_THEME"
  | "REQUEST_SAVE"
  | "SAVE_RESULT"
  | "REQUEST_EXPORT"
  | "FOCUS"
  | "DESTROY";

/** Frame -> parent message types. */
export type FrameMessageType =
  | "READY"
  | "DIRTY_CHANGED"
  | "SAVE_BYTES"
  | "EXPORT_BYTES"
  | "SELECTION_CHANGED"
  | "ERROR"
  | "DESTROYED";

interface EnvelopeBase {
  channel: typeof BRIDGE_CHANNEL;
  v: typeof BRIDGE_PROTOCOL_VERSION;
  /** Opaque per-session secret minted by the parent and echoed by the frame. */
  nonce: string;
  /** Correlates a request with its response/error. */
  requestId?: string;
}

// ── Parent -> frame ──────────────────────────────────────────────────────────

export interface InitMessage extends EnvelopeBase {
  type: "INIT";
  mode: EditorMode;
  theme: EditorTheme;
  /** Display extension only (xlsx/xls/csv) — never the file name. */
  extension: string;
}
export interface OpenEditorBinMessage extends EnvelopeBase {
  type: "OPEN_EDITOR_BIN";
  /** Editor.bin bytes, transferred. */
  bin: ArrayBuffer;
}
export interface SetModeMessage extends EnvelopeBase {
  type: "SET_MODE";
  mode: EditorMode;
}
export interface SetThemeMessage extends EnvelopeBase {
  type: "SET_THEME";
  theme: EditorTheme;
}
export interface RequestSaveMessage extends EnvelopeBase {
  type: "REQUEST_SAVE";
}
export interface SaveResultMessage extends EnvelopeBase {
  type: "SAVE_RESULT";
  ok: boolean;
  requestId: string;
}
export interface RequestExportMessage extends EnvelopeBase {
  type: "REQUEST_EXPORT";
  format: "xlsx";
}
export interface FocusMessage extends EnvelopeBase {
  type: "FOCUS";
}
export interface DestroyMessage extends EnvelopeBase {
  type: "DESTROY";
}

export type ParentMessage =
  | InitMessage
  | OpenEditorBinMessage
  | SetModeMessage
  | SetThemeMessage
  | RequestSaveMessage
  | SaveResultMessage
  | RequestExportMessage
  | FocusMessage
  | DestroyMessage;

// ── Frame -> parent ──────────────────────────────────────────────────────────

export interface ReadyMessage extends EnvelopeBase {
  type: "READY";
}
export interface DirtyChangedMessage extends EnvelopeBase {
  type: "DIRTY_CHANGED";
  dirty: boolean;
}
export interface SaveBytesMessage extends EnvelopeBase {
  type: "SAVE_BYTES";
  /** Complete serialized document bytes, transferred. */
  format: SavedDocumentFormat;
  bin: ArrayBuffer;
}
export interface ExportBytesMessage extends EnvelopeBase {
  type: "EXPORT_BYTES";
  format: "xlsx";
  bin: ArrayBuffer;
}
/** Minimal selection info for Xenode comments: sheet + A1 range only. */
export interface SelectionChangedMessage extends EnvelopeBase {
  type: "SELECTION_CHANGED";
  sheet: string;
  range: string;
}
export interface ErrorMessage extends EnvelopeBase {
  type: "ERROR";
  /** Stable machine code; never a document-derived string. */
  code: string;
  message?: string;
}
export interface DestroyedMessage extends EnvelopeBase {
  type: "DESTROYED";
}

export type FrameMessage =
  | ReadyMessage
  | DirtyChangedMessage
  | SaveBytesMessage
  | ExportBytesMessage
  | SelectionChangedMessage
  | ErrorMessage
  | DestroyedMessage;

export type BridgeMessage = ParentMessage | FrameMessage;

const PARENT_TYPES: ReadonlySet<string> = new Set<ParentMessageType>([
  "INIT",
  "OPEN_EDITOR_BIN",
  "SET_MODE",
  "SET_THEME",
  "REQUEST_SAVE",
  "SAVE_RESULT",
  "REQUEST_EXPORT",
  "FOCUS",
  "DESTROY",
]);

const FRAME_TYPES: ReadonlySet<string> = new Set<FrameMessageType>([
  "READY",
  "DIRTY_CHANGED",
  "SAVE_BYTES",
  "EXPORT_BYTES",
  "SELECTION_CHANGED",
  "ERROR",
  "DESTROYED",
]);

export type Direction = "parent" | "frame";

export interface ValidateOptions {
  /** Which direction the receiver expects (`frame` = we are the parent,
   *  receiving frame messages; `parent` = we are the frame). */
  expect: Direction;
  /** The session nonce that a valid message must echo. */
  nonce: string;
  /** Reject any message whose transferred buffer exceeds this many bytes. */
  maxPayloadBytes: number;
}

export type ValidationResult =
  | { ok: true; message: BridgeMessage }
  | { ok: false; reason: string };

/** Structurally validate an untrusted `event.data`. Origin/source checks are
 *  the caller's responsibility (see `parentBridge`), because only the caller
 *  knows the expected window/origin. This function guards everything that lives
 *  *inside* the payload: channel tag, version, nonce, direction, type, and the
 *  size of any transferred buffer. */
export function validateEnvelope(
  data: unknown,
  opts: ValidateOptions,
): ValidationResult {
  if (typeof data !== "object" || data === null) {
    return { ok: false, reason: "not_an_object" };
  }
  const env = data as Record<string, unknown>;
  if (env.channel !== BRIDGE_CHANNEL) return { ok: false, reason: "wrong_channel" };
  if (env.v !== BRIDGE_PROTOCOL_VERSION) return { ok: false, reason: "version_mismatch" };
  if (typeof env.nonce !== "string" || env.nonce.length === 0) {
    return { ok: false, reason: "missing_nonce" };
  }
  // Constant-time-ish equality is unnecessary here (both values are local),
  // but a strict compare stops replay from a stale/foreign session.
  if (env.nonce !== opts.nonce) return { ok: false, reason: "nonce_mismatch" };
  if (typeof env.type !== "string") return { ok: false, reason: "missing_type" };

  const allowed = opts.expect === "frame" ? FRAME_TYPES : PARENT_TYPES;
  if (!allowed.has(env.type)) return { ok: false, reason: "unexpected_type" };

  if (env.requestId !== undefined && typeof env.requestId !== "string") {
    return { ok: false, reason: "bad_request_id" };
  }
  if (env.type === "SAVE_RESULT") {
    if (typeof env.requestId !== "string" || env.requestId.length === 0) {
      return { ok: false, reason: "bad_request_id" };
    }
    if (typeof env.ok !== "boolean") {
      return { ok: false, reason: "bad_save_result" };
    }
  }

  if (env.type === "OPEN_EDITOR_BIN" && !(env.bin instanceof ArrayBuffer)) {
    return { ok: false, reason: "missing_binary_payload" };
  }
  if (env.type === "SAVE_BYTES") {
    if (!(env.bin instanceof ArrayBuffer)) {
      return { ok: false, reason: "missing_binary_payload" };
    }
    if (env.format !== "xlsx" && env.format !== "editor-bin") {
      return { ok: false, reason: "bad_saved_document_format" };
    }
  }
  if (env.type === "EXPORT_BYTES") {
    if (!(env.bin instanceof ArrayBuffer)) {
      return { ok: false, reason: "missing_binary_payload" };
    }
    if (env.format !== "xlsx") {
      return { ok: false, reason: "bad_export_format" };
    }
  }

  const buffer = extractBuffer(env);
  if (buffer && buffer.byteLength > opts.maxPayloadBytes) {
    return { ok: false, reason: "payload_too_large" };
  }

  return { ok: true, message: env as unknown as BridgeMessage };
}

/** The single binary field, if any, carried by a message. */
export function extractBuffer(env: Record<string, unknown>): ArrayBuffer | null {
  const bin = env.bin;
  return bin instanceof ArrayBuffer ? bin : null;
}
