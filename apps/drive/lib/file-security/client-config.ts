"use client";

import { RENDERER_KEYS, type RendererFlags } from "./types";

export interface RendererConfigResponse {
  version: number;
  renderers: RendererFlags;
  expiresAt: string;
}

export const DISABLED_RENDERER_CONFIG: RendererConfigResponse = Object.freeze({
  version: 0,
  renderers: Object.freeze({ global: false, pdf: false, office: false, svg: false, html: false,
    image: false, media: false, archive: false, text: false, onlyOfficeV2: false }),
  expiresAt: new Date(0).toISOString(),
});

async function readConfig(signal: AbortSignal): Promise<RendererConfigResponse> {
  try {
    const response = await fetch("/api/file-security/config", {
      cache: "no-store", credentials: "same-origin", signal,
    });
    if (!response.ok) return DISABLED_RENDERER_CONFIG;
    const next = await response.json() as RendererConfigResponse;
    if (!Number.isSafeInteger(next.version) || next.version < 0 ||
      typeof next.expiresAt !== "string" || !Number.isFinite(Date.parse(next.expiresAt)) ||
      !next.renderers || typeof next.renderers.global !== "boolean") return DISABLED_RENDERER_CONFIG;
    const renderers = { ...DISABLED_RENDERER_CONFIG.renderers };
    renderers.global = next.renderers.global;
    for (const key of RENDERER_KEYS) {
      if (next.renderers[key] !== undefined && typeof next.renderers[key] !== "boolean") return DISABLED_RENDERER_CONFIG;
      renderers[key] = next.renderers.global && next.renderers[key] === true;
    }
    return Object.freeze({ version: next.version, renderers: Object.freeze(renderers), expiresAt: next.expiresAt });
  } catch {
    return DISABLED_RENDERER_CONFIG;
  }
}

/** One hook instance's external fetch resource; no React state or persistence. */
export function createRendererConfigSource() {
  let current = DISABLED_RENDERER_CONFIG;
  let generation = 0;
  let pending: { controller: AbortController; promise: Promise<RendererConfigResponse> } | null = null;
  const listeners = new Set<() => void>();
  const publish = (value: RendererConfigResponse) => {
    current = value;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => current,
    getServerSnapshot: () => DISABLED_RENDERER_CONFIG,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh: (): Promise<RendererConfigResponse> => {
      if (pending) return pending.promise;
      const requestGeneration = ++generation;
      const controller = new AbortController();
      const promise = readConfig(controller.signal).then((value) => {
        if (requestGeneration !== generation || controller.signal.aborted) return DISABLED_RENDERER_CONFIG;
        publish(value);
        return value;
      }).finally(() => {
        if (requestGeneration === generation) pending = null;
      });
      pending = { controller, promise };
      return promise;
    },
    cancel: () => {
      generation += 1;
      pending?.controller.abort();
      pending = null;
      publish(DISABLED_RENDERER_CONFIG);
    },
  };
}
