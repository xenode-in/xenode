"use client";

/**
 * components/sheets-v2/OnlyOfficeFrame.tsx
 *
 * Renders the sandboxed ONLYOFFICE host iframe and owns the parent-side bridge
 * lifecycle. Parents interact through a `ref` handle rather than reaching into
 * the iframe directly, so all cross-origin traffic funnels through the typed,
 * origin-checked bridge.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  OnlyOfficeParentBridge,
  type BridgeHandlers,
} from "@/lib/spreadsheets/v2/bridge/parentBridge";
import type { EditorMode, EditorTheme } from "@/lib/spreadsheets/v2/bridge/protocol";
import { ONLYOFFICE_HOST_URL, resolveEditorOrigin } from "@/lib/spreadsheets/v2/config";

export interface OnlyOfficeFrameHandle {
  init(mode: EditorMode, theme: EditorTheme, extension: string): void;
  openEditorBin(bin: ArrayBuffer): void;
  setMode(mode: EditorMode): void;
  setTheme(theme: EditorTheme): void;
  requestSave(requestId?: string): void;
  requestExport(requestId?: string): void;
  focus(): void;
}

export interface OnlyOfficeFrameProps {
  handlers: BridgeHandlers;
  onRejectMessage?: (reason: string) => void;
  className?: string;
  title?: string;
}

export const OnlyOfficeFrame = forwardRef<OnlyOfficeFrameHandle, OnlyOfficeFrameProps>(
  function OnlyOfficeFrame({ handlers, onRejectMessage, className, title }, ref) {
    const frameRef = useRef<HTMLIFrameElement | null>(null);
    const bridgeRef = useRef<OnlyOfficeParentBridge | null>(null);
    // Stable per-mount session nonce, minted once via a lazy initializer.
    // crypto.randomUUID is available in every supported browser and in the
    // Node SSR runtime, so no impure fallback is needed.
    const [nonce] = useState(() => crypto.randomUUID());
    // Keep the latest handlers without re-creating the bridge on every render.
    const handlersRef = useRef<BridgeHandlers>(handlers);
    useEffect(() => {
      handlersRef.current = handlers;
    }, [handlers]);

    const editorOrigin = resolveEditorOrigin();
    const parentOrigin =
      typeof window !== "undefined" ? window.location.origin : "";
    const src = `${ONLYOFFICE_HOST_URL}#o=${encodeURIComponent(parentOrigin)}&n=${nonce}`;

    const handleLoad = useCallback(() => {
      const frame = frameRef.current;
      if (!frame || bridgeRef.current) return;
      const bridge = new OnlyOfficeParentBridge({
        frame,
        editorOrigin,
        nonce,
        onReject: onRejectMessage,
      });
      // Delegate to the always-current handlers ref.
      bridge.setHandlers({
        onReady: () => handlersRef.current.onReady?.(),
        onDirtyChanged: (d) => handlersRef.current.onDirtyChanged?.(d),
        onSaveBytes: (b, id) => handlersRef.current.onSaveBytes?.(b, id),
        onExportBytes: (b, id) => handlersRef.current.onExportBytes?.(b, id),
        onSelectionChanged: (s, r) => handlersRef.current.onSelectionChanged?.(s, r),
        onError: (c, m) => handlersRef.current.onError?.(c, m),
        onDestroyed: () => handlersRef.current.onDestroyed?.(),
      });
      bridgeRef.current = bridge;
    }, [editorOrigin, nonce, onRejectMessage]);

    useEffect(() => {
      return () => {
        bridgeRef.current?.destroy();
        bridgeRef.current = null;
      };
    }, []);

    useImperativeHandle(
      ref,
      (): OnlyOfficeFrameHandle => ({
        init: (mode, theme, extension) =>
          bridgeRef.current?.init(mode, theme, extension),
        openEditorBin: (bin) => bridgeRef.current?.openEditorBin(bin),
        setMode: (mode) => bridgeRef.current?.setMode(mode),
        setTheme: (theme) => bridgeRef.current?.setTheme(theme),
        requestSave: (id) => bridgeRef.current?.requestSave(id),
        requestExport: (id) => bridgeRef.current?.requestExport(id),
        focus: () => bridgeRef.current?.focus(),
      }),
      [],
    );

    return (
      <iframe
        ref={frameRef}
        src={src}
        title={title ?? "Xenode Sheets v2 editor"}
        onLoad={handleLoad}
        className={className}
        // Grant only what the editor provably needs. No allow-popups,
        // allow-top-navigation, or allow-downloads: saves flow through the
        // bridge, not browser downloads.
        sandbox="allow-scripts allow-same-origin"
        allow=""
      />
    );
  },
);
