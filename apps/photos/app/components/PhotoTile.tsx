"use client";

import { usePhotoSelection } from "./SelectionController";
import type { TimelineAsset } from "./Timeline";

export function PhotoTile({
  asset,
  onOpen,
}: {
  asset: TimelineAsset;
  onOpen(asset: TimelineAsset): void;
}) {
  const selection = usePhotoSelection();
  const checked = selection.selected.has(asset.id);
  return (
    <article
      style={{
        position: "relative",
        minHeight: 142,
        borderRadius: 10,
        overflow: "hidden",
        background: "linear-gradient(135deg,var(--border),var(--card))",
        outline: checked ? "3px solid var(--primary)" : "1px solid var(--border)",
      }}
    >
      <button
        type="button"
        onClick={() => onOpen(asset)}
        style={{
          width: "100%",
          height: "100%",
          minHeight: 142,
          border: 0,
          color: "white",
          background: "transparent",
          textAlign: "left",
          padding: 12,
        }}
      >
        <strong>{asset.mediaType === "video" ? "Video" : "Photo"}</strong>
        <small style={{ display: "block", marginTop: 76, color: "var(--muted-foreground)" }}>
          {new Date(asset.takenAt).toLocaleString()}
        </small>
      </button>
      <input
        aria-label={`Select ${asset.id}`}
        type="checkbox"
        checked={checked}
        onChange={() => selection.toggle(asset.id)}
        style={{ position: "absolute", top: 10, right: 10 }}
      />
    </article>
  );
}
