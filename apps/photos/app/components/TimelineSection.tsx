"use client";

import { PhotoTile } from "./PhotoTile";
import type { TimelineAsset } from "./Timeline";

export function TimelineSection({
  assets,
  columns,
  startRow,
  rowHeight,
  onOpen,
}: {
  assets: TimelineAsset[];
  columns: number;
  startRow: number;
  rowHeight: number;
  onOpen(asset: TimelineAsset): void;
}) {
  return (
    <section
      aria-label="Visible photos"
      style={{
        position: "absolute",
        top: startRow * rowHeight,
        left: 0,
        right: 0,
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 8,
      }}
    >
      {assets.map((asset) => (
        <PhotoTile key={asset.id} asset={asset} onOpen={onOpen} />
      ))}
    </section>
  );
}
