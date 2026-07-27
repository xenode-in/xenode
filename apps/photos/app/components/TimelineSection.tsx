"use client";

import { forwardRef, useEffect, useMemo, useState } from "react";
import { PhotoTile } from "./PhotoTile";
import type { TimelineAsset, TimelineGroup } from "./Timeline";
import { usePhotoSelection } from "./SelectionController";
import { Check } from "lucide-react";
import { cn } from "@xenode/ui";

export const TimelineSection = forwardRef<
  HTMLElement,
  {
    group: TimelineGroup;
    density: "comfortable" | "compact";
    onOpen(asset: TimelineAsset): void;
  }
>(function TimelineSection({ group, density, onOpen }, ref) {
  const selection = usePhotoSelection();
  const [windowWidth, setWindowWidth] = useState(0);
  const selectedCount = group.assets.filter((asset) =>
    selection.selected.has(asset.id),
  ).length;
  const allSelected =
    group.assets.length > 0 && selectedCount === group.assets.length;
  const partlySelected = selectedCount > 0 && !allSelected;

  function toggleGroup() {
    for (const asset of group.assets) {
      const selected = selection.selected.has(asset.id);
      if ((allSelected && selected) || (!allSelected && !selected)) {
        selection.toggle(asset.id);
      }
    }
  }

  useEffect(() => {
    const updateWidth = () => setWindowWidth(window.innerWidth);
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  const columns = useMemo(() => {
    const count = getColumnCount(windowWidth);
    const result: TimelineAsset[][] = Array.from(
      { length: count },
      () => [],
    );
    group.assets.forEach((asset, index) => result[index % count].push(asset));
    return result;
  }, [group.assets, windowWidth]);

  return (
    <section ref={ref} className="scroll-mt-24" aria-label={group.label}>
      <header className="sticky top-16 z-20 mb-3 flex items-center gap-3 border-b border-border/40 bg-background/90 py-2 backdrop-blur-lg">
        <button
          type="button"
          onClick={toggleGroup}
          className={cn(
            "grid size-5 place-items-center rounded-full border transition",
            allSelected || partlySelected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-transparent hover:border-primary/60",
          )}
          aria-label={
            allSelected ? `Deselect ${group.label}` : `Select ${group.label}`
          }
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
      {density === "comfortable" ? (
        <div className="flex items-start gap-2 sm:gap-3">
          {columns.map((column, index) => (
            <div key={index} className="flex min-w-0 flex-1 flex-col gap-2 sm:gap-3">
              {column.map((asset) => (
                <PhotoTile
                  key={asset.id}
                  asset={asset}
                  density={density}
                  onOpen={onOpen}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-8">
          {group.assets.map((asset) => (
            <PhotoTile
              key={asset.id}
              asset={asset}
              density={density}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </section>
  );
});

function getColumnCount(width: number) {
  if (width >= 1280) return 5;
  if (width >= 1024) return 4;
  if (width >= 768) return 3;
  return 2;
}
