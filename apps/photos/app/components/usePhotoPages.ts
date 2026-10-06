"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TimelineAsset } from "./Timeline";

/**
 * Cursor-paged asset list (timeline, album or trash). `path` carries every
 * query parameter except the page cursor and size.
 */
export function usePhotoPages(path: string) {
  const [items, setItems] = useState<TimelineAsset[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  const load = useCallback(
    async (next: string | null) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setLoading(true);
      setError("");
      try {
        const url = new URL(path, window.location.origin);
        url.searchParams.set("limit", "180");
        if (next) url.searchParams.set("cursor", next);
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error("Could not load your photos");
        const payload = (await response.json()) as {
          items: Array<
            TimelineAsset & { assetId?: string; takenAt: string | Date }
          >;
          nextCursor: string | null;
        };
        const incoming = payload.items.map((item) => ({
          ...item,
          id: item.id ?? item.assetId ?? "",
          takenAt: new Date(item.takenAt).toISOString(),
        }));
        setItems((current) => {
          const merged = new Map(
            (next ? current : []).map((item) => [item.id, item]),
          );
          for (const item of incoming) merged.set(item.id, item);
          return [...merged.values()];
        });
        setCursor(payload.nextCursor);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load your photos",
        );
      } finally {
        inFlight.current = false;
        setLoaded(true);
        setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(null), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Pages load as the grid nears its end; after a failure, only on retry.
  const loadMore = useCallback(() => {
    if (cursor && !error) void load(cursor);
  }, [cursor, error, load]);

  return { items, setItems, cursor, loaded, loading, error, load, loadMore };
}

/**
 * Apply a lifecycle action in API-sized batches (at most 100 assets each).
 * Returns the ids applied before any failure, and that failure.
 */
export async function changePhotoAssets(
  action: "trash" | "restore" | "purge",
  spaceId: string,
  assetIds: string[],
) {
  const done: string[] = [];
  for (let start = 0; start < assetIds.length; start += 100) {
    const batch = assetIds.slice(start, start + 100);
    const response = await fetch(
      `/api/photos/assets/${action}?spaceId=${encodeURIComponent(spaceId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetIds: batch }),
      },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      return { done, error: payload.error ?? "Photo operation unavailable" };
    }
    done.push(...batch);
  }
  return { done, error: null };
}
