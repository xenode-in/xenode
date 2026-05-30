"use client";

import { forwardRef } from "react";

/**
 * The sandboxed surface the document engine mounts into. The vendored engine
 * (or the stub) drives this element — it sets `srcdoc`/`src` and paints into it;
 * the shell only hands the element to `createOnlyOfficeAdapter`.
 *
 * `sandbox="allow-scripts allow-same-origin"` is required: the engine needs
 * scripts to run and same-origin to fetch its own assets + WASM from
 * `/onlyoffice/`. Egress is shut off by the locked-down CSP on `/onlyoffice/*`
 * (see next.config.ts), so the iframe can never make a cross-origin request —
 * decrypted bytes stay on the device.
 */
export const EditorIframe = forwardRef<
  HTMLIFrameElement,
  { title?: string; className?: string }
>(function EditorIframe({ title = "Document editor", className }, ref) {
  return (
    <iframe
      ref={ref}
      title={title}
      className={className}
      sandbox="allow-scripts allow-same-origin"
    />
  );
});
