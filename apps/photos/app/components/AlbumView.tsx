"use client";

import type { AlbumSummary } from "./AlbumsList";

export function AlbumView({
  album,
  onBack,
}: {
  album: AlbumSummary;
  onBack(): void;
}) {
  return (
    <section>
      <button type="button" onClick={onBack}>Back to albums</button>
      <h2>Encrypted album</h2>
      <p>{album.photoAssetIds.length} accessible assets</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 8 }}>
        {album.photoAssetIds.map((id) => (
          <div key={id} style={{ minHeight: 110, background: "var(--card)", padding: 8 }}>
            {id.slice(0, 8)}
          </div>
        ))}
      </div>
    </section>
  );
}
