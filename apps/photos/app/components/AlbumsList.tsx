"use client";

export type AlbumSummary = {
  albumId: string;
  encryptedName: string;
  photoAssetIds: string[];
};

export function AlbumsList({
  albums,
  onOpen,
}: {
  albums: AlbumSummary[];
  onOpen(album: AlbumSummary): void;
}) {
  if (!albums.length) return <p>No albums yet.</p>;
  return (
    <section style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
      {albums.map((album) => (
        <button
          key={album.albumId}
          type="button"
          onClick={() => onOpen(album)}
          style={{ minHeight: 130, textAlign: "left", padding: 16 }}
        >
          <strong>Encrypted album</strong>
          <small style={{ display: "block", marginTop: 60 }}>
            {album.photoAssetIds.length} assets
          </small>
        </button>
      ))}
    </section>
  );
}
