"use client";

import { useCallback, useEffect, useState } from "react";
import type { RendererFlags } from "@/lib/file-security/types";

const DISABLED: RendererFlags = {
  global: false,
  pdf: false,
  office: false,
  svg: false,
  html: false,
  image: false,
  media: false,
  archive: false,
  text: false,
  onlyOfficeV2: false,
};

interface RendererConfigResponse {
  version: number;
  renderers: RendererFlags;
  expiresAt: string;
}

export function useRendererConfig() {
  const [config, setConfig] = useState<RendererConfigResponse>({
    version: 0,
    renderers: DISABLED,
    expiresAt: new Date(0).toISOString(),
  });

  const refresh = useCallback(async (): Promise<RendererConfigResponse> => {
    try {
      const response = await fetch("/api/file-security/config", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Renderer configuration unavailable");
      const next = (await response.json()) as RendererConfigResponse;
      if (!next.renderers?.global) {
        const disabled = {
          ...next,
          renderers: { ...DISABLED, ...next.renderers },
        };
        setConfig(disabled);
        return disabled;
      }
      setConfig(next);
      return next;
    } catch {
      const disabled = {
        version: 0,
        renderers: DISABLED,
        expiresAt: new Date().toISOString(),
      };
      setConfig(disabled);
      return disabled;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { ...config, refresh };
}
