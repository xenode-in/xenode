/**
 * public/onlyoffice/engine.js — Xenode's main-window ONLYOFFICE engine factory.
 *
 * Loaded (as a classic script) into the MAIN window by lib/onlyoffice/x2tLoader.ts,
 * which reads window.__XENODE_ONLYOFFICE__.createAdapter from here. This module is
 * the trusted first-party half of the bridge: it owns the postMessage channel to
 * the sandboxed, egress-locked inner page (editor.html) and implements the
 * OnlyOfficeAdapter the React shell talks to (see lib/onlyoffice/adapter.ts).
 *
 * Frame topology:
 *   main window (this file, has the decrypted bytes)
 *     └─ shell's sandboxed iframe  ←—postMessage—→  editor.html (x2t + DocsAPI)
 *           └─ ONLYOFFICE's own "frameEditor" (the native ribbon UI)
 *
 * SECURITY (do not weaken):
 *   - We transfer the decrypted document to the iframe by CLONE, never by
 *     transfer: the shell reuses the same ArrayBuffer for its "download decrypted
 *     copy" fallback, and transferring would detach (zero) it. Cloning keeps the
 *     plaintext on-device (same-origin postMessage, no network).
 *   - We never log document bytes, never persist them, and only accept messages
 *     from our own iframe at our own origin.
 */
(function () {
  "use strict";

  var ENGINE_ORIGIN = window.location.origin;
  var EDITOR_URL = "/onlyoffice/editor.html";
  var READY_TIMEOUT_MS = 60000;

  function createAdapter(init) {
    return new Promise(function (resolve, reject) {
      var iframe = init.container;
      if (!iframe || iframe.tagName !== "IFRAME") {
        reject(new Error("ONLYOFFICE adapter requires an iframe container."));
        return;
      }

      var destroyed = false;
      var settled = false; // ready or error has happened
      var frameReady = false;
      var saveSeq = 0;
      var pending = Object.create(null); // id -> { resolve, reject }
      var readyTimer = null;

      function iframeWin() { return iframe.contentWindow; }

      function postToFrame(msg, transfer) {
        var w = iframeWin();
        if (w) w.postMessage(msg, ENGINE_ORIGIN, transfer || []);
      }

      function clearReadyTimer() {
        if (readyTimer !== null) { clearTimeout(readyTimer); readyTimer = null; }
      }

      function fireError(message) {
        if (settled) return;
        settled = true;
        clearReadyTimer();
        try { init.onError(new Error(message || "Editor error")); } catch (e) { /* noop */ }
      }

      function onMessage(ev) {
        if (ev.origin !== ENGINE_ORIGIN) return;
        if (ev.source !== iframeWin()) return;
        var msg = ev.data;
        if (!msg || typeof msg !== "object") return;

        switch (msg.kind) {
          case "xenode:frame-ready":
            if (frameReady || destroyed) return;
            frameReady = true;
            // Hand the decrypted bytes to the inner page. CLONE (no transfer) so
            // the shell's own copy stays intact for the download fallback.
            postToFrame({
              kind: "xenode:init",
              document: init.document,
              format: init.format,
              editable: init.editable,
            });
            break;
          case "xenode:ready":
            if (settled) return;
            settled = true;
            clearReadyTimer();
            try { init.onReady(); } catch (e) { /* noop */ }
            break;
          case "xenode:dirty":
            try { init.onDirty(); } catch (e) { /* noop */ }
            break;
          case "xenode:error":
            fireError(msg.message);
            break;
          case "xenode:saved": {
            var p = pending[msg.id];
            if (p) { delete pending[msg.id]; p.resolve(msg.document); }
            break;
          }
          case "xenode:saveError": {
            var pe = pending[msg.id];
            if (pe) { delete pending[msg.id]; pe.reject(new Error(msg.message || "Save failed")); }
            break;
          }
          case "xenode:log":
            if (window.console && console.debug) console.debug("[onlyoffice]", msg.message);
            break;
          default:
            break;
        }
      }

      window.addEventListener("message", onMessage);

      function requestSave(format) {
        if (destroyed) return Promise.reject(new Error("Editor destroyed."));
        var id = "s" + (++saveSeq);
        return new Promise(function (res, rej) {
          pending[id] = { resolve: res, reject: rej };
          postToFrame({ kind: "xenode:save", id: id, format: format });
        });
      }

      var adapter = {
        // Formatting/structure commands are handled by ONLYOFFICE's native ribbon
        // inside the iframe, so these are intentionally no-ops at the boundary.
        exec: function () {},
        setFontFamily: function () {},
        setFontSize: function () {},
        setHeading: function () {},
        insertTable: function () {},
        insertImage: function () {},
        save: function () { return requestSave(init.format); },
        exportAs: function (format) { return requestSave(format); },
        destroy: function () {
          if (destroyed) return;
          destroyed = true;
          clearReadyTimer();
          window.removeEventListener("message", onMessage);
          try { postToFrame({ kind: "xenode:destroy" }); } catch (e) { /* noop */ }
          Object.keys(pending).forEach(function (k) {
            try { pending[k].reject(new Error("Editor destroyed.")); } catch (e) { /* noop */ }
            delete pending[k];
          });
          // Drop the heavy editor subtree so its memory can be reclaimed.
          try { iframe.removeAttribute("src"); } catch (e) { /* noop */ }
        },
      };

      // If neither ready nor error arrives in time, surface a clear failure
      // instead of an indefinite spinner.
      readyTimer = setTimeout(function () {
        readyTimer = null;
        fireError("The document editor took too long to load.");
      }, READY_TIMEOUT_MS);

      // Kick off the inner page; it replies with "xenode:frame-ready".
      iframe.src = EDITOR_URL;

      // The adapter is usable now; onReady fires later when the document renders.
      resolve(adapter);
    });
  }

  window.__XENODE_ONLYOFFICE__ = { createAdapter: createAdapter };
})();
