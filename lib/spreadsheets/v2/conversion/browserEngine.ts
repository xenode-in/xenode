/**
 * lib/spreadsheets/v2/conversion/browserEngine.ts
 *
 * Loads the compiled x2t WASM module from the pinned, self-hosted editor
 * artifact and adapts it to `X2tEngine`. All URLs point at the same-origin
 * (or dedicated editor-origin) immutable directory — never a CDN or the
 * ONLYOFFICE Document Server.
 *
 * The module is produced by tools/onlyoffice/Dockerfile.x2t (CryptPad's recipe)
 * and expected at:
 *   ${ONLYOFFICE_EDITOR_URL}/x2t/x2t.js     (Emscripten glue + pre-js.js)
 *   ${ONLYOFFICE_EDITOR_URL}/x2t/x2t.wasm   (located via pre-js.js locateFile)
 *
 * IMPORTANT: CryptPad's build is a CLASSIC Emscripten module (NOT MODULARIZE) —
 * loading x2t.js populates the global `Module`, with `noInitialRun` set by
 * pre-js.js so `main` does not auto-run. We pre-seed `window.Module` with an
 * `onRuntimeInitialized` hook before injecting the script, then drive the
 * converter via `Module.ccall("main1", ...)` + `Module.FS`.
 *
 * Until the artifact is built, `version.json.x2tReady` is false and this loader
 * throws `X2tUnavailableError`, so callers can cleanly fall back to v1.
 */

import { ONLYOFFICE_EDITOR_URL } from "../config";
import {
  adaptRawModule,
  ensureWorkDirs,
  FONTS_DIR,
  RawX2tModule,
  X2tEngine,
  X2tUnavailableError,
} from "./engine";

const X2T_DIR = `${ONLYOFFICE_EDITOR_URL}/x2t`;

/**
 * CryptPad's generated x2t pre-js reads currentScript.getAttribute("src") and
 * passes it to the one-argument URL constructor. Keep the injected attribute
 * absolute so a same-origin relative editor base cannot trigger `Invalid URL`.
 */
export function resolveX2tScriptUrl(baseUrl: string): string {
  return new URL(`${X2T_DIR}/x2t.js`, baseUrl).href;
}

/** Cap on how many fonts to preload into the WASM FS at startup. x2t only needs
 *  enough coverage to measure text; loading the full core-fonts set would be
 *  tens of MB of requests. Browser-cached (immutable) after first load. */
const MAX_FONTS = Number(process.env.NEXT_PUBLIC_SHEETS_V2_MAX_FONTS) || 60;

// The global the Emscripten glue reads/populates. CryptPad's build uses the
// default name `Module`.
declare global {
  interface Window {
    Module?: Partial<RawX2tModule> & {
      onRuntimeInitialized?: () => void;
      onAbort?: (reason: unknown) => void;
    };
  }
}

let enginePromise: Promise<X2tEngine> | null = null;

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

function loadModule(): Promise<RawX2tModule> {
  if (typeof window === "undefined") {
    return Promise.reject(new X2tUnavailableError("no_window"));
  }
  return new Promise<RawX2tModule>((resolve, reject) => {
    // Pre-seed the global Module so the glue merges our hooks. pre-js.js will
    // add noInitialRun/noExitRuntime and its own locateFile (which resolves
    // x2t.wasm next to x2t.js), so we do not set locateFile here.
    const settle = (ok: boolean, reason?: unknown) => {
      if (ok) resolve(window.Module as unknown as RawX2tModule);
      else reject(new X2tUnavailableError(reason));
    };
    window.Module = {
      onRuntimeInitialized: () => settle(true),
      onAbort: (reason) => settle(false, reason),
    };
    const el = document.createElement("script");
    el.src = resolveX2tScriptUrl(document.baseURI);
    el.async = true;
    el.onerror = () => settle(false, "script_load_failed");
    document.head.appendChild(el);
  });
}

/**
 * x2t measures text against real font files, so the WASM font dir must be
 * populated before any conversion. The build stamps a `fonts.manifest.json`
 * (paths relative to the artifact root); we fetch a bounded subset and write
 * them into the module's MEMFS. Best-effort: a missing manifest logs and
 * proceeds (simple sheets may still convert with substitution).
 */
async function loadFonts(mod: RawX2tModule): Promise<void> {
  let manifest: string[];
  try {
    const res = await fetch(`${X2T_DIR}/fonts.manifest.json`, { cache: "force-cache" });
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    manifest = (await res.json()) as string[];
  } catch (err) {
    console.warn("[sheets-v2] font manifest unavailable; x2t may substitute fonts", err);
    return;
  }
  const wanted = manifest.filter((p) => /\.ttf$/i.test(p)).slice(0, MAX_FONTS);
  await Promise.all(
    wanted.map(async (rel) => {
      try {
        const res = await fetch(`${ONLYOFFICE_EDITOR_URL}/${rel}`, { cache: "force-cache" });
        if (!res.ok) return;
        const bytes = new Uint8Array(await res.arrayBuffer());
        const base = rel.split("/").pop()!;
        mod.FS.writeFile(`${FONTS_DIR}/${base}`, bytes);
      } catch {
        // skip an individual font that fails to load
      }
    }),
  );
}

export async function loadBrowserX2tEngine(): Promise<X2tEngine> {
  if (!(await probeX2tReady())) {
    throw new X2tUnavailableError("artifact_not_ready");
  }
  // The WASM module is a process-wide singleton (global Module); reuse it.
  if (!enginePromise) {
    enginePromise = loadModule()
      .then(async (mod) => {
        ensureWorkDirs(mod);
        await loadFonts(mod);
        return adaptRawModule(mod);
      })
      .catch((err) => {
        enginePromise = null;
        throw err instanceof X2tUnavailableError ? err : new X2tUnavailableError(err);
      });
  }
  return enginePromise;
}
