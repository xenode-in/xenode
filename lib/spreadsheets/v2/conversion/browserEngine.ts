/**
 * lib/spreadsheets/v2/conversion/browserEngine.ts
 *
 * Loads the compiled x2t WASM module from the pinned, self-hosted editor
 * artifact and adapts it to `X2tEngine`. All URLs point at the same-origin
 * (or dedicated editor-origin) immutable directory — never a CDN or the
 * ONLYOFFICE Document Server.
 *
 * The module is produced by `tools/onlyoffice/Dockerfile.x2t` and expected at:
 *   ${ONLYOFFICE_EDITOR_URL}/x2t/x2t.js     (Emscripten glue, exposes createX2T)
 *   ${ONLYOFFICE_EDITOR_URL}/x2t/x2t.wasm   (loaded via locateFile)
 *
 * Until that build has run, `version.json.x2tReady` is false and this loader
 * throws `X2tUnavailableError`, so callers can cleanly fall back to v1.
 */

import { ONLYOFFICE_EDITOR_URL } from "../config";
import { adaptRawModule, RawX2tModule, X2tEngine, X2tUnavailableError } from "./engine";

const X2T_DIR = `${ONLYOFFICE_EDITOR_URL}/x2t`;

type X2tFactory = (overrides: {
  locateFile: (path: string) => string;
}) => Promise<RawX2tModule>;

declare global {
  interface Window {
    createX2T?: X2tFactory;
  }
}

let scriptPromise: Promise<X2tFactory> | null = null;

/** Confirm the artifact declares x2t as built before we try to load it. */
export async function probeX2tReady(): Promise<boolean> {
  try {
    const res = await fetch(`${ONLYOFFICE_EDITOR_URL}/version.json`, {
      cache: "no-store",
    });
    if (!res.ok) return false;
    const manifest = (await res.json()) as { x2tReady?: boolean };
    return manifest.x2tReady === true;
  } catch {
    return false;
  }
}

function loadScript(): Promise<X2tFactory> {
  if (typeof window === "undefined") {
    return Promise.reject(new X2tUnavailableError("no_window"));
  }
  if (window.createX2T) return Promise.resolve(window.createX2T);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<X2tFactory>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = `${X2T_DIR}/x2t.js`;
    el.async = true;
    el.onload = () => {
      if (window.createX2T) resolve(window.createX2T);
      else reject(new X2tUnavailableError("factory_missing"));
    };
    el.onerror = () => {
      scriptPromise = null;
      reject(new X2tUnavailableError("script_load_failed"));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

export async function loadBrowserX2tEngine(): Promise<X2tEngine> {
  if (!(await probeX2tReady())) {
    throw new X2tUnavailableError("artifact_not_ready");
  }
  let factory: X2tFactory;
  try {
    factory = await loadScript();
  } catch (err) {
    throw err instanceof X2tUnavailableError ? err : new X2tUnavailableError(err);
  }
  const mod = await factory({
    locateFile: (path: string) => `${X2T_DIR}/${path}`,
  });
  return adaptRawModule(mod);
}
