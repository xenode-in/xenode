/**
 * lib/spreadsheets/v2/bridge/parentBridge.ts
 *
 * Parent-side (Xenode app) half of the iframe bridge. Owns the exact-origin
 * `postMessage` channel to the ONLYOFFICE host, validates every inbound
 * message, and exposes a small typed API to the React layer.
 *
 * Security posture:
 *  - Outbound messages always target the exact editor origin, never "*".
 *  - Inbound messages are rejected unless origin AND source window match, the
 *    channel/version/nonce are correct, and the payload is within size limits.
 *  - Binary buffers are transferred (zero-copy) in both directions.
 *  - `destroy()` is idempotent and removes the listener, so a torn-down bridge
 *    can never resurrect via a late message.
 */

import {
  BRIDGE_CHANNEL,
  BRIDGE_PROTOCOL_VERSION,
  validateEnvelope,
  type EditorMode,
  type EditorTheme,
  type FrameMessage,
  type ParentMessage,
} from "./protocol";
import { MAX_BRIDGE_PAYLOAD_BYTES } from "../limits";

export interface ParentBridgeOptions {
  /** The iframe element hosting the editor. Must already be in the DOM. */
  frame: HTMLIFrameElement;
  /** Exact origin of the editor (e.g. `https://sheets-v2.xenode.in` or, in
   *  same-origin dev, `window.location.origin`). Never a wildcard. */
  editorOrigin: string;
  /** Per-session nonce. Generate with `crypto.randomUUID()` per mount. */
  nonce: string;
  maxPayloadBytes?: number;
  /** Optional sink for rejected messages (diagnostics). Receives only the
   *  machine reason, never payload contents. */
  onReject?: (reason: string) => void;
}

export interface BridgeHandlers {
  onReady?: () => void;
  onDirtyChanged?: (dirty: boolean) => void;
  onSaveBytes?: (bytes: Uint8Array, requestId?: string) => void;
  onExportBytes?: (bytes: Uint8Array, requestId?: string) => void;
  onSelectionChanged?: (sheet: string, range: string) => void;
  onError?: (code: string, message?: string) => void;
  onDestroyed?: () => void;
}

export class OnlyOfficeParentBridge {
  private readonly frame: HTMLIFrameElement;
  private readonly editorOrigin: string;
  private readonly nonce: string;
  private readonly maxPayloadBytes: number;
  private readonly onReject?: (reason: string) => void;
  private handlers: BridgeHandlers = {};
  private listener: ((event: MessageEvent) => void) | null = null;
  private destroyed = false;

  constructor(opts: ParentBridgeOptions) {
    this.frame = opts.frame;
    this.editorOrigin = opts.editorOrigin;
    this.nonce = opts.nonce;
    this.maxPayloadBytes = opts.maxPayloadBytes ?? MAX_BRIDGE_PAYLOAD_BYTES;
    this.onReject = opts.onReject;
    this.listener = (event) => this.receive(event);
    window.addEventListener("message", this.listener);
  }

  setHandlers(handlers: BridgeHandlers): void {
    this.handlers = handlers;
  }

  // ── Inbound ────────────────────────────────────────────────────────────────

  private receive(event: MessageEvent): void {
    if (this.destroyed) return;
    // Origin and source must both match: origin alone is spoofable across
    // same-origin frames, source alone across a shared origin.
    if (event.origin !== this.editorOrigin) return;
    if (event.source !== this.frame.contentWindow) return;

    const result = validateEnvelope(event.data, {
      expect: "frame",
      nonce: this.nonce,
      maxPayloadBytes: this.maxPayloadBytes,
    });
    if (!result.ok) {
      this.onReject?.(result.reason);
      return;
    }
    this.dispatch(result.message as FrameMessage);
  }

  private dispatch(msg: FrameMessage): void {
    switch (msg.type) {
      case "READY":
        this.handlers.onReady?.();
        break;
      case "DIRTY_CHANGED":
        this.handlers.onDirtyChanged?.(msg.dirty);
        break;
      case "SAVE_BYTES":
        this.handlers.onSaveBytes?.(new Uint8Array(msg.bin), msg.requestId);
        break;
      case "EXPORT_BYTES":
        this.handlers.onExportBytes?.(new Uint8Array(msg.bin), msg.requestId);
        break;
      case "SELECTION_CHANGED":
        this.handlers.onSelectionChanged?.(msg.sheet, msg.range);
        break;
      case "ERROR":
        this.handlers.onError?.(msg.code, msg.message);
        break;
      case "DESTROYED":
        this.handlers.onDestroyed?.();
        break;
    }
  }

  // ── Outbound ─────────────────────────────────────────────────────────────

  private post(message: ParentMessage, transfer?: Transferable[]): void {
    if (this.destroyed) return;
    const target = this.frame.contentWindow;
    if (!target) return;
    target.postMessage(message, this.editorOrigin, transfer);
  }

  private envelope<T extends { type: ParentMessage["type"] }>(
    body: T,
    requestId?: string,
  ) {
    return {
      channel: BRIDGE_CHANNEL,
      v: BRIDGE_PROTOCOL_VERSION,
      nonce: this.nonce,
      requestId,
      ...body,
    } as const;
  }

  init(mode: EditorMode, theme: EditorTheme, extension: string): void {
    this.post(this.envelope({ type: "INIT", mode, theme, extension }));
  }

  /** Hand the Editor.bin to the editor. The buffer is transferred, so the
   *  caller must not touch it afterwards. */
  openEditorBin(bin: ArrayBuffer): void {
    this.post(this.envelope({ type: "OPEN_EDITOR_BIN", bin }), [bin]);
  }

  setMode(mode: EditorMode): void {
    this.post(this.envelope({ type: "SET_MODE", mode }));
  }

  setTheme(theme: EditorTheme): void {
    this.post(this.envelope({ type: "SET_THEME", theme }));
  }

  requestSave(requestId?: string): void {
    this.post(this.envelope({ type: "REQUEST_SAVE" }, requestId));
  }

  requestExport(requestId?: string): void {
    this.post(this.envelope({ type: "REQUEST_EXPORT", format: "xlsx" }, requestId));
  }

  focus(): void {
    this.post(this.envelope({ type: "FOCUS" }));
  }

  /** Ask the frame to tear itself down, then stop listening locally. */
  destroy(): void {
    if (this.destroyed) return;
    // Best-effort DESTROY so the frame can release workers/URLs; ignore if the
    // frame is already gone.
    try {
      this.post(this.envelope({ type: "DESTROY" }));
    } catch {
      // frame detached — nothing to notify
    }
    this.destroyed = true;
    if (this.listener) {
      window.removeEventListener("message", this.listener);
      this.listener = null;
    }
    this.handlers = {};
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }
}
