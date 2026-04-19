/**
 * lib/metadata/mediainfo-loader.ts
 *
 * Browser-safe shim for mediainfo.js.
 *
 * The real mediainfo.js npm package uses `import.meta.url` to locate its
 * WASM file, which Turbopack cannot resolve at build time. This shim loads
 * the pre-built UMD bundle and WASM from /public/mediainfo/ at runtime via a
 * <script> tag, so the bundler never touches the WASM asset pipeline.
 *
 * Aliased via next.config.ts:
 *   turbopack.resolveAlias["mediainfo.js"] = "./lib/metadata/mediainfo-loader"
 */

const SCRIPT_URL = "/mediainfo/mediainfo.js";

let loading: Promise<void> | null = null;

function injectScript(): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      // SSR – skip, mediainfo only runs in the browser
      resolve();
      return;
    }
    if (window.MediaInfo) {
      resolve();
      return;
    }
    if (document.querySelector(`script[src="${SCRIPT_URL}"]`)) {
      // Already injected – poll until it's ready
      const poll = setInterval(() => {
        if (window.MediaInfo) {
          clearInterval(poll);
          resolve();
        }
      }, 50);
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error(`Failed to load MediaInfo script from ${SCRIPT_URL}`));
    document.head.appendChild(script);
  });
  return loading;
}

interface MediaInfoInstance {
  analyzeData: (getSize: () => number, readChunk: (sz: number, off: number) => Promise<Uint8Array>) => Promise<unknown>;
  close: () => void;
}

type MediaInfoFactoryFunction = (opts?: Record<string, unknown>) => Promise<MediaInfoInstance>;

interface GlobalMediaInfo {
  default?: MediaInfoFactoryFunction;
  mediaInfoFactory?: MediaInfoFactoryFunction;
}

declare global {
  var MediaInfo: GlobalMediaInfo | undefined;
}

const MediaInfoFactory: (opts?: Record<string, unknown>) => Promise<MediaInfoInstance> = async (opts = {}) => {
  await injectScript();

  // The UMD build sets globalThis.MediaInfo = { default: mediaInfoFactory, mediaInfoFactory, ... }
  const MediaInfo = (globalThis as unknown as { MediaInfo: GlobalMediaInfo }).MediaInfo;
  if (!MediaInfo) throw new Error("MediaInfo not available after script load");

  const factory = MediaInfo.default ?? MediaInfo.mediaInfoFactory;
  if (!factory) throw new Error("MediaInfo factory not found in global object");

  return factory({
    ...opts,
    locateFile: (path: string) => `/mediainfo/${path}`,
  });
};

export default MediaInfoFactory;
