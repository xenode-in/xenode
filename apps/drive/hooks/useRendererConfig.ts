"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createRendererConfigSource } from "@/lib/file-security/client-config";

export function useRendererConfig() {
  const [source] = useState(createRendererConfigSource);
  const config = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getServerSnapshot);

  useEffect(() => {
    void source.refresh();
    const interval = window.setInterval(() => void source.refresh(), 60_000);
    return () => {
      window.clearInterval(interval);
      source.cancel();
    };
  }, [source]);

  return { ...config, refresh: source.refresh };
}
