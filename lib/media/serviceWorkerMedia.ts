export interface ServiceWorkerMediaSessionOptions {
  urls: string[];
  rawDEK: ArrayBuffer;
  chunkSize: number;
  chunkCount: number;
  chunkIvs: string[];
  contentType: string;
  cipherSize: number;
  initialCiphertext?: ArrayBuffer;
}

export interface ServiceWorkerMediaSession {
  url: string;
  close: () => void;
}

const ACTIVATION_TIMEOUT_MS = 8_000;
const REGISTRATION_TIMEOUT_MS = 8_000;

function randomCapability(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function waitForController(
  expectedWorker: ServiceWorker,
): Promise<ServiceWorker> {
  if (navigator.serviceWorker.controller === expectedWorker) {
    return Promise.resolve(expectedWorker);
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      reject(new Error("Media service worker did not take control"));
    }, ACTIVATION_TIMEOUT_MS);

    function onControllerChange() {
      if (navigator.serviceWorker.controller !== expectedWorker) return;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      resolve(expectedWorker);
    }

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );
  });
}

async function waitForActiveWorker(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorker> {
  const candidate =
    registration.installing ?? registration.waiting ?? registration.active;
  if (!candidate) throw new Error("Media service worker is unavailable");
  const worker: ServiceWorker = candidate;
  if (worker.state === "activated") return worker;

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.removeEventListener("statechange", onStateChange);
      reject(new Error("Media service worker activation timed out"));
    }, ACTIVATION_TIMEOUT_MS);

    function onStateChange() {
      if (worker.state === "activated") {
        window.clearTimeout(timeout);
        worker.removeEventListener("statechange", onStateChange);
        resolve();
      } else if (worker.state === "redundant") {
        window.clearTimeout(timeout);
        worker.removeEventListener("statechange", onStateChange);
        reject(new Error("Media service worker became redundant"));
      }
    }

    worker.addEventListener("statechange", onStateChange);
  });

  return worker;
}

export async function createServiceWorkerMediaSession(
  options: ServiceWorkerMediaSessionOptions,
): Promise<ServiceWorkerMediaSession> {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    throw new Error("Secure service-worker streaming is unavailable");
  }
  if (
    options.urls.length === 0 ||
    options.urls.length !== options.chunkCount ||
    options.chunkIvs.length !== options.chunkCount
  ) {
    throw new Error("Invalid encrypted media chunk metadata");
  }

  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  const activeWorker = await waitForActiveWorker(registration);
  const worker = await waitForController(activeWorker);
  const token = randomCapability();
  const channel = new MessageChannel();
  const initialCiphertext = options.initialCiphertext?.slice(0);
  const transfer: Transferable[] = [channel.port2];
  if (initialCiphertext) transfer.push(initialCiphertext);

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error("Media service-worker registration timed out"));
    }, REGISTRATION_TIMEOUT_MS);

    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      const message = event.data;
      if (
        message &&
        typeof message === "object" &&
        "type" in message &&
        "token" in message &&
        message.type === "MEDIA_SESSION_READY" &&
        message.token === token
      ) {
        resolve();
        return;
      }
      reject(
        new Error(
          message &&
            typeof message === "object" &&
            "error" in message &&
            typeof message.error === "string"
            ? message.error
            : "Media service-worker registration failed",
        ),
      );
    };

    worker.postMessage(
      {
        type: "REGISTER_MEDIA_SESSION",
        token,
        rawDEK: options.rawDEK.slice(0),
        urls: options.urls,
        chunkSize: options.chunkSize,
        chunkCount: options.chunkCount,
        chunkIvs: options.chunkIvs,
        contentType: options.contentType,
        cipherSize: options.cipherSize,
        initialCiphertext,
      },
      transfer,
    );
  });

  let closed = false;
  return {
    url: `/__xenode_media__/${token}`,
    close: () => {
      if (closed) return;
      closed = true;
      try {
        worker.postMessage({ type: "CLOSE_MEDIA_SESSION", token });
      } catch {
        // The worker may already have stopped during navigation.
      }
    },
  };
}
