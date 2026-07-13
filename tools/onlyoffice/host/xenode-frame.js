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

  // ── Editor adapter: CryptPad server-less ONLYOFFICE integration ─────────────
  // Loads the CryptPad wrapper (web-apps/apps/api/documents/api.js), which
  // replaces DocsAPI.DocEditor with a server-less version driven by a "mock
  // server". On the editor's `auth` the wrapper answers `documentOpen` with the
  // Editor.bin at config.document.url — so we hand it a blob URL of the bytes
  // the parent transferred. Verified end-to-end (open + render) via lab.html.
  var API_URL = "../web-apps/apps/api/documents/api.js";

  function loadDocsApi() {
    return new Promise(function (resolve, reject) {
      if (window.DocsAPI && window.DocsAPI.DocEditor) return resolve();
      var el = document.createElement("script");
      el.src = API_URL;
      el.onload = function () {
        window.DocsAPI && window.DocsAPI.DocEditor
          ? resolve()
          : reject(new Error("docs_api_missing"));
      };
      el.onerror = function () { reject(new Error("api_load_failed")); };
      document.head.appendChild(el);
    });
  }

  function createEditorAdapter(callbacks) {
    // The wrapper writes window.APP.getImageURL during connectMockServer.
    window.APP = window.APP || {};
    var editor = null;
    var blobUrl = null;
    var dirty = false;
    var lastSaveBin = null; // most recent Editor.bin captured from the editor
    var pendingSave = null; // requestId awaiting SAVE_BYTES

    // Minimal single-user mock server. Participant shape matches what
    // onAuthParticipantsChanged/getUserInitials read (username required).
    var participant = {
      id: "xenode-user", idOriginal: "xenode-user", username: "Xenode",
      indexUser: 0, connectionId: "xenode-conn", isCloseCoAuthoring: false, view: false,
    };
    var mockServer = {
      getInitialChanges: function () { return []; },
      getParticipants: function () { return { list: [participant], index: 0 }; },
      onAuth: function () {},
      onCorruptionWarning: function () { callbacks.onError("workbook_corruption"); },
      onMessage: function (msg) {
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "saveChanges" || msg.type === "unsaveLock") {
          if (!dirty) { dirty = true; callbacks.onDirty(true); }
        }
        // The editor emits the serialized document (checkpoint) here; the exact
        // save-message shape is validated separately (see host README). When a
        // full Editor.bin is present, surface it to the parent.
        var bin = extractSavedBin(msg);
        if (bin) {
          lastSaveBin = bin;
          if (pendingSave) {
            callbacks.onSave(bin, pendingSave);
            pendingSave = null;
          }
          if (dirty) { dirty = false; callbacks.onDirty(false); }
        }
      },
    };

    function extractSavedBin(msg) {
      // ONLYOFFICE's coauthoring "saveChanges" carries change deltas, not a full
      // bin; a checkpoint bin arrives via a save/download path. This is the
      // remaining piece to validate — returns null until confirmed so we never
      // hand the parent a wrong/partial payload.
      return null;
    }

    function buildConfig(binUrl) {
      return {
        documentType: "cell",
        document: {
          fileType: state.extension || "xlsx",
          key: "xenode-" + Math.random().toString(16).slice(2),
          title: "workbook." + (state.extension || "xlsx"),
          url: binUrl,
          permissions: { edit: state.mode !== "view", download: true },
        },
        editorConfig: {
          mode: state.mode === "view" ? "view" : "edit",
          lang: "en",
          user: { id: participant.id, name: participant.username },
          customization: { comments: false, chat: false, plugins: false, help: false },
        },
        events: {
          onAppReady: function () {},
          onDocumentReady: function () { setPlaceholder(""); callbacks.onReady(); },
          onError: function (e) {
            callbacks.onError("editor_error", e && e.data ? String(e.data) : "");
          },
        },
      };
    }

    return {
      open: function (binArrayBuffer) {
        setPlaceholder("Loading editor…");
        try {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          blobUrl = URL.createObjectURL(new Blob([binArrayBuffer]));
        } catch (e) {
          return callbacks.onError("blob_failed", String(e));
        }
        loadDocsApi()
          .then(function () {
            editor = new window.DocsAPI.DocEditor("oo-mount", buildConfig(blobUrl));
            if (typeof editor.connectMockServer === "function") {
              editor.connectMockServer(mockServer);
            } else {
              callbacks.onError("mock_server_unavailable");
            }
          })
          .catch(function (e) { callbacks.onError("editor_load_failed", String(e && e.message || e)); });
      },
      setMode: function (mode) { state.mode = mode; },
      setTheme: function (theme) { state.theme = theme; },
      requestSave: function (requestId) {
        // Trigger the editor to serialize, then SAVE_BYTES flows via onMessage.
        pendingSave = requestId || "save";
        if (lastSaveBin) { callbacks.onSave(lastSaveBin, pendingSave); pendingSave = null; return; }
        try {
          if (editor && typeof editor.downloadAs === "function") editor.downloadAs();
        } catch (e) { void e; }
      },
      requestExport: function (requestId) {
        if (lastSaveBin) return callbacks.onExport(lastSaveBin, requestId);
        callbacks.onError("export_pending", "no serialized workbook yet");
      },
      focus: function () { try { editor && editor.grabFocus && editor.grabFocus(); } catch (e) { void e; } },
      destroy: function () {
        try { editor && editor.destroyEditor && editor.destroyEditor(); } catch (e) { void e; }
        if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (e) { void e; } blobUrl = null; }
        editor = null;
      },
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
