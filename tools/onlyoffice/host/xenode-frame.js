/*
 * tools/onlyoffice/host/xenode-frame.js
 *
 * Frame side of the Xenode <-> ONLYOFFICE bridge. This file is served from the
 * editor origin (inside the sandboxed iframe) and speaks the exact protocol
 * defined in apps/drive/lib/office-editor/bridge/protocol.ts. It is plain ES5-ish
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

  var CHANNEL = "xenode.office-editor.v1";
  var VERSION = 2;

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
  function sendSaveBytes(buffer, format, requestId) {
    post({ type: "SAVE_BYTES", format: format, bin: buffer }, [buffer], requestId);
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
    var pendingSave = null; // requestId awaiting SAVE_BYTES
    var saveTimer = null;
    var changeGeneration = 0;
    var localSaveSequence = 0;
    var activeSave = null;

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
          changeGeneration += 1;
          if (!dirty) { dirty = true; callbacks.onDirty(true); }
        }
      },
    };

    function clearSaveTimer() {
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
    }

    function toArrayBuffer(value) {
      if (value instanceof ArrayBuffer) return value;
      if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) {
        return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      }
      return null;
    }

    function extractSavedDocument(event) {
      var value = event;
      if (value && typeof value === "object" && value.data !== undefined) {
        value = value.data;
      }
      var buffer = toArrayBuffer(value);
      if (buffer) return buffer;
      if (value && typeof value === "object" && value.buffer !== undefined) {
        return toArrayBuffer(value.buffer);
      }
      return null;
    }

    function detectSavedDocumentFormat(buffer) {
      var bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4));
      if (
        bytes.length >= 4 &&
        bytes[0] === 0x50 &&
        bytes[1] === 0x4b &&
        ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
          (bytes[2] === 0x05 && bytes[3] === 0x06) ||
          (bytes[2] === 0x07 && bytes[3] === 0x08))
      ) {
        return "xlsx";
      }
      return "editor-bin";
    }

    function handleSavedDocument(event) {
      var buffer = extractSavedDocument(event);
      if (!buffer || buffer.byteLength === 0) {
        clearSaveTimer();
        pendingSave = null;
        callbacks.onError("save_payload_missing", "ONLYOFFICE returned no document bytes");
        return;
      }
      var requestId = pendingSave;
      pendingSave = null;
      clearSaveTimer();
      if (dirty) { dirty = false; callbacks.onDirty(false); }
      callbacks.onSave(buffer, detectSavedDocumentFormat(buffer), requestId);
    }

    function getEditorApi() {
      var frame = editor && typeof editor.getIframe === "function"
        ? editor.getIframe()
        : document.querySelector('iframe[name="frameEditor"]');
      var frameWindow = frame && frame.contentWindow;
      return frameWindow && frameWindow.Asc && frameWindow.Asc.editor
        ? frameWindow.Asc.editor
        : frameWindow && frameWindow.editor;
    }

    function encodeUtf8(value) {
      if (typeof TextEncoder !== "undefined") {
        return new TextEncoder().encode(value).buffer;
      }
      var bytes = new Uint8Array(value.length);
      for (var i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i) & 0xff;
      return bytes.buffer;
    }

    function serializeEditorBin() {
      var api = getEditorApi();
      if (!api || typeof api.asc_nativeGetFile !== "function") {
        throw new Error("editor_binary_serializer_unavailable");
      }
      if (
        api.wbModel &&
        api.wbModel.dependencyFormulas &&
        typeof api.wbModel.dependencyFormulas.calcTree === "function"
      ) {
        api.wbModel.dependencyFormulas.calcTree();
      }
      var serialized = api.asc_nativeGetFile();
      var buffer = typeof serialized === "string"
        ? encodeUtf8(serialized)
        : toArrayBuffer(serialized);
      if (!buffer || buffer.byteLength === 0) {
        throw new Error("editor_binary_serializer_empty");
      }
      var signature = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength));
      if (
        signature.length < 5 ||
        signature[0] !== 0x58 ||
        signature[1] !== 0x4c ||
        signature[2] !== 0x53 ||
        signature[3] !== 0x59 ||
        signature[4] !== 0x3b
      ) {
        throw new Error("editor_binary_signature_invalid");
      }
      return buffer;
    }

    function emitSerializedEditorBin(requestId) {
      if (!dirty || activeSave) return false;
      var resolvedRequestId = requestId || "local-save-" + (++localSaveSequence);
      var buffer = serializeEditorBin();
      activeSave = {
        requestId: resolvedRequestId,
        generation: changeGeneration,
      };
      callbacks.onSave(buffer, "editor-bin", resolvedRequestId);
      return true;
    }

    function completeSave(requestId, ok) {
      if (!activeSave || activeSave.requestId !== requestId) return;
      var savedGeneration = activeSave.generation;
      activeSave = null;
      if (!ok) return;
      if (savedGeneration === changeGeneration) {
        dirty = false;
      }
      callbacks.onDirty(dirty);
    }

    function installLocalSaveHook() {
      var api = getEditorApi();
      if (!api || api.__xenodeLocalSaveInstalled) return;
      api.__xenodeLocalSaveInstalled = true;
      api.asc_Save = function (isAutoSave) {
        // Internal autosave must never create a Xenode storage revision.
        if (isAutoSave === true || !dirty || activeSave) return true;
        try {
          emitSerializedEditorBin();
          return true;
        } catch (e) {
          callbacks.onError("save_trigger_failed", String(e && e.message || e));
          return false;
        }
      };
    }

    function watchEditorFrameSize() {
      function applySize() {
        var frame = document.querySelector('iframe[name="frameEditor"]');
        if (!frame) return false;
        frame.setAttribute("width", "100%");
        frame.setAttribute("height", "100%");
        frame.style.display = "block";
        frame.style.width = "100%";
        frame.style.height = "100%";
        frame.style.border = "0";
        return true;
      }
      if (applySize()) return;
      var root = document.getElementById("editor");
      if (!root || typeof MutationObserver === "undefined") return;
      var observer = new MutationObserver(function () {
        if (applySize()) observer.disconnect();
      });
      observer.observe(root, { childList: true, subtree: true });
      setTimeout(function () { observer.disconnect(); }, 10000);
    }
    function buildConfig(binUrl) {
      return {
        type: "desktop",
        width: "100%",
        height: "100%",
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
          customization: {
            comments: false,
            chat: false,
            plugins: false,
            help: false,
            logo: { visible: false },
          },
        },
        events: {
          onAppReady: function () {},
          onDocumentReady: function () {
            setPlaceholder("");
            installLocalSaveHook();
            callbacks.onReady();
          },
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
            watchEditorFrameSize();
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
        if (state.mode === "view") {
          callbacks.onError("read_only", "This workbook is read only");
          return;
        }
        if (!dirty || activeSave) return;
        try {
          emitSerializedEditorBin(requestId);
        } catch (e) {
          callbacks.onError("save_trigger_failed", String(e && e.message || e));
        }
      },
      saveResult: function (requestId, ok) {
        completeSave(requestId, ok === true);
      },
      requestExport: function (requestId) {
        callbacks.onError("export_unsupported", "Use Save while XLSX export is being integrated");
      },
      focus: function () { try { editor && editor.grabFocus && editor.grabFocus(); } catch (e) { void e; } },
      destroy: function () {
        try { editor && editor.destroyEditor && editor.destroyEditor(); } catch (e) { void e; }
        if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (e) { void e; } blobUrl = null; }
        clearSaveTimer();
        pendingSave = null;
        activeSave = null;
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
      case "SAVE_RESULT":
        if (typeof msg.requestId !== "string" || typeof msg.ok !== "boolean") {
          sendError("bad_payload", "SAVE_RESULT is invalid");
          return;
        }
        adapter.saveResult(msg.requestId, msg.ok);
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
