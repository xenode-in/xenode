"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTimelineWindow } from "@/lib/virtual-timeline";
import { TimelineSection } from "./TimelineSection";
import { Scrubber } from "./Scrubber";

export type TimelineAsset = {
  id: string;
  mediaType: "image" | "video";
  takenAt: string;
  width?: number;
  height?: number;
};

const COLUMNS = 6;
const ROW_HEIGHT = 152;
const VIEWPORT_HEIGHT = 620;

export function Timeline({
  spaceId,
  onOpen,
}: {
  spaceId: string;
  onOpen(asset: TimelineAsset): void;
}) {
  const [items, setItems] = useState<TimelineAsset[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (next: string | null) => {
      const url = new URL("/api/photos/timeline", window.location.origin);
      url.searchParams.set("spaceId", spaceId);
      url.searchParams.set("limit", "180");
      if (next) url.searchParams.set("cursor", next);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load timeline");
      const payload = (await response.json()) as {
        items: Array<TimelineAsset & { assetId?: string }>;
        nextCursor: string | null;
      };
      setItems((current) => [
        ...current,
        ...payload.items.map((item) => ({
          ...item,
          id: item.id ?? item.assetId ?? "",
        })),
      ]);
      setCursor(payload.nextCursor);
      setLoaded(true);
    },
    [spaceId],
  );

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setLoaded(false);
    void load(null);
  }, [load]);

  const virtualWindow = getTimelineWindow({
    itemCount: items.length,
    scrollTop,
    viewportHeight: VIEWPORT_HEIGHT,
    columns: COLUMNS,
    rowHeight: ROW_HEIGHT,
  });
  const visible = useMemo(
    () =>
      items.slice(
        virtualWindow.startIndex,
        virtualWindow.endIndex,
      ),
    [items, virtualWindow.endIndex, virtualWindow.startIndex],
  );

  return (
    <section style={{ display: "grid", gap: 12 }}>
      <Scrubber
        value={virtualWindow.startRow}
        max={Math.max(
          virtualWindow.totalRows - virtualWindow.viewportRows,
          0,
        )}
        onChange={(row) => {
          if (viewport.current) viewport.current.scrollTop = row * ROW_HEIGHT;
        }}
      />
      <div
        ref={viewport}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        style={{
          height: VIEWPORT_HEIGHT,
          overflow: "auto",
          position: "relative",
          contain: "strict",
        }}
      >
        <div
          style={{
            height: virtualWindow.totalRows * ROW_HEIGHT,
            position: "relative",
          }}
        >
          <TimelineSection
            assets={visible}
            columns={COLUMNS}
            startRow={virtualWindow.startRow}
            rowHeight={ROW_HEIGHT}
            onOpen={onOpen}
          />
        </div>
      </div>
      {loaded && items.length === 0 ? <p>No photos yet.</p> : null}
      {cursor ? (
        <button type="button" onClick={() => void load(cursor)}>
          Load older memories
        </button>
      ) : null}
    </section>
  );
}
