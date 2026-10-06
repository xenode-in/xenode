"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Check } from "lucide-react";
import { cn } from "@xenode/ui";
import { PhotoTile } from "./PhotoTile";
import { Scrubber } from "./Scrubber";
import { usePhotoSelection } from "./SelectionController";
import type { TimelineAsset, TimelineGroup } from "./Timeline";

const GAP = 8;
const HEADER_HEIGHT = 52;
const MIN_TILE = { comfortable: 200, compact: 112 };
const MIN_COLUMNS = { comfortable: 2, compact: 3 };

type Row =
  | { kind: "header"; group: TimelineGroup }
  | { kind: "tiles"; assets: TimelineAsset[] };

/**
 * Square-tile grid that mounts only the rows near the viewport, so a library
 * of any size keeps a bounded DOM (and bounded decrypted previews, which
 * tiles release on unmount). Groups with a label get a header row.
 */
export function PhotoGrid({
  groups,
  density,
  onOpen,
  onEndReached,
}: {
  groups: TimelineGroup[];
  density: "comfortable" | "compact";
  onOpen(asset: TimelineAsset): void;
  /** Called when the last rows are mounted; the caller loads the next page. */
  onEndReached?(): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [offset, setOffset] = useState(0);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      setWidth(element.clientWidth);
      setOffset(element.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = Math.max(
    MIN_COLUMNS[density],
    Math.floor((width + GAP) / (MIN_TILE[density] + GAP)),
  );
  const tile = width
    ? (width - GAP * (columns - 1)) / columns
    : MIN_TILE[density];

  const rows = useMemo(() => {
    const result: Row[] = [];
    for (const group of groups) {
      if (group.label) result.push({ kind: "header", group });
      for (let start = 0; start < group.assets.length; start += columns) {
        result.push({
          kind: "tiles",
          assets: group.assets.slice(start, start + columns),
        });
      }
    }
    return result;
  }, [groups, columns]);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (index) =>
      rows[index]?.kind === "header" ? HEADER_HEIGHT : tile + GAP,
    overscan: 3,
    scrollMargin: offset,
    // Keep scrubber targets clear of the sticky app header.
    scrollPaddingStart: 80,
  });
  useEffect(() => virtualizer.measure(), [virtualizer, rows, tile]);

  const items = virtualizer.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? -1;
  useEffect(() => {
    // An empty grid has reached its end too (e.g. a page of trashed album items).
    if (lastIndex >= rows.length - 3) onEndReached?.();
  }, [lastIndex, rows.length, onEndReached]);

  const headerRows = useMemo(
    () =>
      new Map(
        rows.flatMap((row, index) =>
          row.kind === "header" ? [[row.group.label, index] as const] : [],
        ),
      ),
    [rows],
  );

  return (
    <div className="flex items-start gap-5">
      <div
        ref={container}
        className="relative min-w-0 flex-1"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {items.map((item) => {
          const row = rows[item.index];
          return (
            <div
              key={
                row.kind === "header"
                  ? `header:${row.group.label}`
                  : `tiles:${row.assets[0].id}`
              }
              className="absolute inset-x-0 top-0"
              style={{
                height: item.size,
                transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              {row.kind === "header" ? (
                <GroupHeader group={row.group} />
              ) : (
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gap: GAP,
                    height: tile,
                  }}
                >
                  {row.assets.map((asset) => (
                    <PhotoTile key={asset.id} asset={asset} onOpen={onOpen} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Scrubber
        groups={groups}
        onChange={(label) => {
          const index = headerRows.get(label);
          if (index !== undefined) {
            virtualizer.scrollToIndex(index, { align: "start" });
          }
        }}
      />
    </div>
  );
}

function GroupHeader({ group }: { group: TimelineGroup }) {
  const selection = usePhotoSelection();
  const selectedCount = group.assets.filter((asset) =>
    selection.selected.has(asset.id),
  ).length;
  const allSelected = selectedCount === group.assets.length;
  const partlySelected = selectedCount > 0 && !allSelected;

  function toggleGroup() {
    for (const asset of group.assets) {
      if (selection.selected.has(asset.id) === allSelected) {
        selection.toggle(asset.id);
      }
    }
  }

  return (
    <header className="flex h-full items-end gap-3 pb-3">
      <button
        type="button"
        onClick={toggleGroup}
        className={cn(
          "grid size-5 place-items-center rounded-full border transition",
          allSelected || partlySelected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card text-transparent hover:border-primary/60",
        )}
        aria-label={`Select ${group.label}`}
        aria-pressed={allSelected ? true : partlySelected ? "mixed" : false}
      >
        {allSelected ? (
          <Check className="size-3" />
        ) : partlySelected ? (
          <span className="h-0.5 w-2 rounded-full bg-current" />
        ) : null}
      </button>
      <h2 className="text-sm font-semibold">{group.label}</h2>
      <span className="text-xs text-muted-foreground">
        {group.assets.length}
      </span>
    </header>
  );
}
