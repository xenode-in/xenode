/**
 * lib/onlyoffice/x2tLoader.ts
 *
 * Loads the *vendored* ONLYOFFICE engine at runtime and hands back its
 * `createAdapter` factory. The engine is never bundled by Next — it is served
 * same-origin from `public/onlyoffice/` so it can run under a locked-down CSP
 * with no cross-origin egress.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * VENDORING CONTRACT (how to make the real editor work)
 * ───────────────────────────────────────────────────────────────────────────
 * The pure-client, E2EE-preserving approach is the one pioneered by CryptPad
 * (github.com/cryptpad/onlyoffice-builds). It bundles ONLYOFFICE's `sdkjs`
 * editor + the `x2t` WASM converter and runs them with no Document Server.
 * NOTE: those assets are AGPL-3.0 and multiple MB — vendor them deliberately.
 *
 * Place under `public/onlyoffice/`:
 *   1. `manifest.json` — `{ "version": string, "entry": string }` where `entry`
 *      is the script filename to load (e.g. "engine.js").
 *   2. The `entry` script (a classic, non-module script) which:
 *        - loads sdkjs + x2t.wasm from `/onlyoffice/...` (all same-origin), and
 *        - assigns `window.__XENODE_ONLYOFFICE__ = { createAdapter }`
 *          implementing {@link CreateAdapter} from `./adapter`.
 *
 * Until those exist, `loadOnlyOfficeEngine()` rejects with
 * {@link EngineNotVendoredError}; the shell renders the engine-unavailable
 * error state (with a download fallback), and `?stub=1` / the stub env flag
 * swaps in {@link createStubAdapter} so the shell itself stays demoable.
 */

import { EngineNotVendoredError, type CreateAdapter } from "./adapter";

export const ENGINE_BASE = "/onlyoffice";
export const ENGINE_MANIFEST_URL = `${ENGINE_BASE}/manifest.json`;
const ENGINE_GLOBAL = "__XENODE_ONLYOFFICE__";
const SCRIPT_LOAD_TIMEOUT_MS = 30_000;

interface EngineManifest {
  version: string;
  entry: string;
}

interface EngineGlobal {
  createAdapter: CreateAdapter;
}

declare global {
  interface Window {
    __XENODE_ONLYOFFICE__?: EngineGlobal;
  }
}

let cached: Promise<CreateAdapter> | null = null;

/**
 * Resolve the vendored engine's `createAdapter` factory, loading its script
 * once and memoizing the result. Rejects with {@link EngineNotVendoredError}
 * when the assets are missing or malformed.
 */
export function loadOnlyOfficeEngine(
  signal?: AbortSignal,
): Promise<CreateAdapter> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new EngineNotVendoredError("ONLYOFFICE engine can only load in the browser."),
    );
  }
  if (window[ENGINE_GLOBAL]?.createAdapter) {
    return Promise.resolve(window[ENGINE_GLOBAL]!.createAdapter);
  }
  if (!cached) {
    cached = doLoad(signal).catch((err) => {
      cached = null; // allow retry after a transient failure
      throw err;
    });
  }
  return cached;
}

async function doLoad(signal?: AbortSignal): Promise<CreateAdapter> {
  let manifest: EngineManifest;
  try {
    const res = await fetch(ENGINE_MANIFEST_URL, { signal, cache: "no-cache" });
    if (!res.ok) throw new EngineNotVendoredError();
    manifest = (await res.json()) as EngineManifest;
  } catch (err) {
    if (err instanceof EngineNotVendoredError) throw err;
    if (signal?.aborted) throw err;
    throw new EngineNotVendoredError();
  }

  if (!manifest?.entry) {
    throw new EngineNotVendoredError(
      "ONLYOFFICE manifest.json is missing an `entry` script.",
    );
  }

  await injectScript(`${ENGINE_BASE}/${manifest.entry}`, signal);

  const factory = window[ENGINE_GLOBAL]?.createAdapter;
  if (typeof factory !== "function") {
    throw new EngineNotVendoredError(
      `ONLYOFFICE engine script did not register window.${ENGINE_GLOBAL}.createAdapter.`,
    );
  }
  return factory;
}

function injectScript(src: string, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new EngineNotVendoredError("ONLYOFFICE engine script timed out."));
    }, SCRIPT_LOAD_TIMEOUT_MS);

    const onAbort = () => {
      cleanup();
      script.remove();
      reject(new DOMException("Aborted", "AbortError"));
    };

    function cleanup() {
      window.clearTimeout(timer);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    }
    function onLoad() {
      cleanup();
      resolve();
    }
    function onError() {
      cleanup();
      script.remove();
      reject(new EngineNotVendoredError("Failed to load ONLYOFFICE engine script."));
    }

    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort);
    document.head.appendChild(script);
  });
}
