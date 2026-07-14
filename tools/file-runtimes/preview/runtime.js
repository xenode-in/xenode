(() => {
  "use strict";

  const PARENT_ORIGIN = "https://xenode.in";
  const PROTOCOL_VERSION = 1;
  const MAX_BYTES = 50 * 1024 * 1024;
  let bootstrapped = false;
  let port = null;
  let sessionId = "";
  let nonce = "";
  let lastRequestId = 0;
  let state = "CREATED";

  const own = (value, key) =>
    Object.prototype.hasOwnProperty.call(value, key);

  function exactKeys(value, keys) {
    return (
      value !== null &&
      typeof value === "object" &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => own(value, key))
    );
  }

  function send(requestId, type, payload) {
    port.postMessage({
      protocolVersion: PROTOCOL_VERSION,
      sessionId,
      nonce,
      requestId,
      type,
      payload,
    });
  }

  function fail(requestId, message) {
    send(requestId, "ERROR", { message });
    port.close();
    port = null;
    state = "CLOSED";
  }

  function validateMessage(message) {
    const keys = [
      "protocolVersion",
      "sessionId",
      "nonce",
      "requestId",
      "type",
      "byteLength",
      "payload",
    ];
    if (!exactKeys(message, keys) && !exactKeys(message, keys.filter((key) => key !== "byteLength"))) {
      return false;
    }
    if (
      message.protocolVersion !== PROTOCOL_VERSION ||
      message.sessionId !== sessionId ||
      message.nonce !== nonce ||
      !Number.isSafeInteger(message.requestId) ||
      message.requestId <= lastRequestId
    ) {
      return false;
    }
    if (
      message.byteLength !== undefined &&
      (!Number.isSafeInteger(message.byteLength) ||
        message.byteLength < 0 ||
        message.byteLength > MAX_BYTES)
    ) {
      return false;
    }
    return ["INIT", "OPEN", "SAVE", "CLOSE"].includes(message.type);
  }

  function onPortMessage(event) {
    const message = event.data;
    if (!validateMessage(message)) {
      fail(0, "Invalid, oversized, or replayed message");
      return;
    }
    lastRequestId = message.requestId;

    if (message.type === "INIT" && state === "INITIALIZED") {
      state = "READY";
      document.getElementById("status").textContent =
        "Preview renderer disabled pending security approval.";
      send(message.requestId, "READY", { renderer: "preview", enabled: false });
      return;
    }
    if (message.type === "CLOSE") {
      send(message.requestId, "RESULT", { closed: true });
      port.close();
      port = null;
      state = "CLOSED";
      return;
    }
    fail(message.requestId, "Renderer is fail-closed");
  }

  function bootstrap(event) {
    if (bootstrapped) return;
    if (
      event.origin !== PARENT_ORIGIN ||
      event.source !== window.parent ||
      event.ports.length !== 1 ||
      !exactKeys(event.data, [
        "type",
        "protocolVersion",
        "sessionId",
        "nonce",
      ]) ||
      event.data.type !== "XENODE_RUNTIME_BOOTSTRAP" ||
      event.data.protocolVersion !== PROTOCOL_VERSION ||
      typeof event.data.sessionId !== "string" ||
      typeof event.data.nonce !== "string" ||
      event.data.nonce.length < 32
    ) {
      return;
    }
    bootstrapped = true;
    window.removeEventListener("message", bootstrap);
    sessionId = event.data.sessionId;
    nonce = event.data.nonce;
    port = event.ports[0];
    port.onmessage = onPortMessage;
    port.onmessageerror = () => fail(0, "Message decoding failed");
    port.start();
    state = "INITIALIZED";
  }

  window.addEventListener("message", bootstrap);
})();
