/*
 * tools/onlyoffice/host/xenode-frame.js
 *
 * Frame side of the Xenode <-> ONLYOFFICE bridge. This file is served from the
 * editor origin (inside the sandboxed iframe) and speaks the exact protocol
 * defined in lib/spreadsheets/v2/bridge/protocol.ts. It is plain ES5-ish
 * browser JS because it runs at the editor origin, outside the app bundle — the
 * constants below are hand-mirrored from protocol.ts and MUST stay in sync
 * (the version guard makes drift fail closed rather than silently).
 *
 * Security model:
 *  - The parent origin and per-session nonce are supplied via the URL hash
 *    (never a query string, so they never reach a server log).
 *  - Every inbound message is checked for origin, source === window.parent,
 *    channel, version, nonce, and known type before dispatch.
 *  - Binary buffers are transferred, not cloned, in both directions.
 *  - The actual ONLYOFFICE canvas integration is isolated behind
 *    `XenodeEditorAdapter`; until the sdkjs local-editing harness lands it emits
 *    a typed ERROR instead of pretending to edit.
 */
(function () {
  "use strict";

  var CHANNEL = "xenode.sheets.v2";
  var VERSION = 1;

  var hash = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  var PARENT_ORIGIN = decodeURIComponent(hash.get("o") || "");
  var NONCE = hash.get("n") || "";

  var placeholder = document.getElementById("placeholder");
  var placeholderText = document.getElementById("placeholder-text");
  var editorEl = document.getElementById("editor");

  var state = {
    initialized: false,
    mode: "view",
    theme: "light",
    extension: "xlsx",
    adapter: null,
  };

  function setPlaceholder(text) {
    if (placeholderText) placeholderText.textContent = text;
    if (placeholder) placeholder.style.display = text ? "flex" : "none";
  }

  function envelope(body, requestId) {
    body.channel = CHANNEL;
    body.v = VERSION;
    body.nonce = NONCE;
    if (requestId) body.requestId = requestId;
    return body;
  }

  function post(body, transfer, requestId) {
    if (!PARENT_ORIGIN) return;
    parent.postMessage(envelope(body, requestId), PARENT_ORIGIN, transfer || []);
  }

  function sendReady() {
    post({ type: "READY" });
  }
  function sendDirty(dirty) {
    post({ type: "DIRTY_CHANGED", dirty: !!dirty });
  }
  function sendSaveBytes(buffer, requestId) {
    post({ type: "SAVE_BYTES", bin: buffer }, [buffer], requestId);
  }
  function sendExportBytes(buffer, requestId) {
    post({ type: "EXPORT_BYTES", format: "xlsx", bin: buffer }, [buffer], requestId);
  }
  function sendSelection(sheet, range) {
    post({ type: "SELECTION_CHANGED", sheet: String(sheet), range: String(range) });
  }
  function sendError(code, message) {
    post({ type: "ERROR", code: String(code), message: message ? String(message) : undefined });
  }
  function sendDestroyed() {
    post({ type: "DESTROYED" });
  }

  // ── Editor adapter seam ────────────────────────────────────────────────────
  // A real adapter loads web-apps/apps/api/documents/api.js, feeds it the
  // Editor.bin through the local (server-less) editing path, and reports
  // dirty/save/selection back through the callbacks. The stub below keeps the
  // byte plumbing honest end-to-end without faking a working canvas.
  function createEditorAdapter(callbacks) {
    return {
      open: function (/* editorBinArrayBuffer */) {
        setPlaceholder(
          "Bridge connected. The ONLYOFFICE canvas integration (sdkjs local editing) is not wired yet.",
        );
        callbacks.onError(
          "editor_integration_pending",
          "x2t + sdkjs local editing harness not yet integrated",
        );
      },
      setMode: function (mode) {
        state.mode = mode;
      },
      setTheme: function (theme) {
        state.theme = theme;
      },
      requestSave: function (requestId) {
        callbacks.onError("editor_integration_pending", "cannot save before canvas is wired");
        void requestId;
      },
      requestExport: function (requestId) {
        callbacks.onError("editor_integration_pending", "cannot export before canvas is wired");
        void requestId;
      },
      focus: function () {},
      destroy: function () {},
    };
  }

  function ensureAdapter() {
    if (state.adapter) return state.adapter;
    state.adapter = createEditorAdapter({
      onReady: sendReady,
      onDirty: sendDirty,
      onSave: sendSaveBytes,
      onExport: sendExportBytes,
      onSelection: sendSelection,
      onError: sendError,
    });
    return state.adapter;
  }

  // ── Inbound message handling ────────────────────────────────────────────────
  function validate(event) {
    if (!PARENT_ORIGIN || event.origin !== PARENT_ORIGIN) return null;
    if (event.source !== window.parent) return null;
    var data = event.data;
    if (!data || typeof data !== "object") return null;
    if (data.channel !== CHANNEL) return null;
    if (data.v !== VERSION) return null;
    if (data.nonce !== NONCE) return null;
    if (typeof data.type !== "string") return null;
    return data;
  }

  function handle(event) {
    var msg = validate(event);
    if (!msg) return;
    var adapter = ensureAdapter();
    switch (msg.type) {
      case "INIT":
        state.initialized = true;
        state.mode = msg.mode === "edit" ? "edit" : "view";
        state.theme = msg.theme === "dark" ? "dark" : "light";
        state.extension = typeof msg.extension === "string" ? msg.extension : "xlsx";
        sendReady();
        break;
      case "OPEN_EDITOR_BIN":
        if (!(msg.bin instanceof ArrayBuffer)) {
          sendError("bad_payload", "OPEN_EDITOR_BIN missing bin");
          return;
        }
        setPlaceholder("");
        adapter.open(msg.bin);
        break;
      case "SET_MODE":
        adapter.setMode(msg.mode === "edit" ? "edit" : "view");
        break;
      case "SET_THEME":
        adapter.setTheme(msg.theme === "dark" ? "dark" : "light");
        break;
      case "REQUEST_SAVE":
        adapter.requestSave(msg.requestId);
        break;
      case "REQUEST_EXPORT":
        adapter.requestExport(msg.requestId);
        break;
      case "FOCUS":
        adapter.focus();
        break;
      case "DESTROY":
        try {
          adapter.destroy();
        } catch (e) {
          void e;
        }
        window.removeEventListener("message", handle);
        state.adapter = null;
        if (editorEl) editorEl.innerHTML = "";
        sendDestroyed();
        break;
      default:
        break;
    }
  }

  if (!PARENT_ORIGIN || !NONCE) {
    setPlaceholder("Missing session parameters — this host must be opened by Xenode.");
    return;
  }

  window.addEventListener("message", handle);
  // Announce readiness for a handshake even before INIT, so the parent knows
  // the frame script booted.
  sendReady();
})();
