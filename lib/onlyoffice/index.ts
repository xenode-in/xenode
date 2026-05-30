/**
 * lib/onlyoffice/index.ts
 *
 * Single entry point for the editor shell. Everything in `components/editor/**`
 * imports from here and from `./adapter` — never from `./x2tLoader` or
 * `./stubAdapter` directly. That keeps the "drop in the vendored engine" step
 * to exactly one place.
 *
 * `createOnlyOfficeAdapter` decides which implementation to hand back:
 *   - stub mode on  → {@link createStubAdapter} (no engine needed)
 *   - stub mode off → the vendored engine via {@link loadOnlyOfficeEngine};
 *     if its assets are absent this rejects with {@link EngineNotVendoredError}
 *     and the shell renders its engine-unavailable state.
 */

import {
  type CreateAdapter,
  type OnlyOfficeAdapter,
  type OnlyOfficeAdapterInit,
} from "./adapter";
import { loadOnlyOfficeEngine } from "./x2tLoader";
import { createStubAdapter } from "./stubAdapter";

export * from "./adapter";
export { loadOnlyOfficeEngine, ENGINE_BASE, ENGINE_MANIFEST_URL } from "./x2tLoader";
export { createStubAdapter } from "./stubAdapter";

/**
 * True when the editor should use the stub instead of the real engine. Enabled
 * by the build-time env flag `NEXT_PUBLIC_ONLYOFFICE_STUB=1` or, in the browser,
 * the `?stub=1` query param (handy for a quick demo without rebuilding).
 */
export function isStubMode(): boolean {
  if (process.env.NEXT_PUBLIC_ONLYOFFICE_STUB === "1") return true;
  if (typeof window !== "undefined") {
    try {
      return new URLSearchParams(window.location.search).get("stub") === "1";
    } catch {
      return false;
    }
  }
  return false;
}

export interface CreateAdapterOptions {
  /** Aborts the engine script/manifest load (e.g. component unmount). */
  signal?: AbortSignal;
  /** Force the stub regardless of {@link isStubMode}. Used by tests. */
  forceStub?: boolean;
}

/**
 * Resolve an {@link OnlyOfficeAdapter} for the given document. In stub mode this
 * never touches the network; otherwise it loads the vendored engine once
 * (memoized) and delegates to its `createAdapter` factory.
 */
export async function createOnlyOfficeAdapter(
  init: OnlyOfficeAdapterInit,
  options: CreateAdapterOptions = {},
): Promise<OnlyOfficeAdapter> {
  if (options.forceStub || isStubMode()) {
    return createStubAdapter(init);
  }

  const createAdapter: CreateAdapter = await loadOnlyOfficeEngine(options.signal);
  return createAdapter(init);
}
