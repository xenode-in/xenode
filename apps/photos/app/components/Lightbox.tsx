"use client";

import type { TimelineAsset } from "./Timeline";

export function Lightbox({
  asset,
  onClose,
}: {
  asset: TimelineAsset | null;
  onClose(): void;
}) {
  if (!asset) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,.88)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div style={{ maxWidth: 720, padding: 32, textAlign: "center" }}>
        <div
          style={{
            width: 560,
            maxWidth: "80vw",
            aspectRatio: "16/10",
            background: "#18181b",
            border: "1px solid #3f3f46",
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
          }}
        >
          Encrypted {asset.mediaType} preview
        </div>
        <p>{new Date(asset.takenAt).toLocaleString()}</p>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
