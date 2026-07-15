"use client";

import { useState } from "react";

export function AlbumEditor({
  spaceId,
  selectedIds,
  onCreated,
}: {
  spaceId: string;
  selectedIds: string[];
  onCreated(): void;
}) {
  const [encryptedName, setEncryptedName] = useState("");
  const [status, setStatus] = useState("");
  async function create() {
    const response = await fetch(
      `/api/photos/albums?spaceId=${encodeURIComponent(spaceId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          encryptedName,
          photoAssetIds: selectedIds,
        }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setStatus(response.ok ? "Album created." : payload.error ?? "Album failed.");
    if (response.ok) {
      setEncryptedName("");
      onCreated();
    }
  }
  return (
    <details>
      <summary>Create album from selection</summary>
      <input
        aria-label="Encrypted album name envelope"
        placeholder="Encrypted name envelope"
        value={encryptedName}
        onChange={(event) => setEncryptedName(event.target.value)}
      />
      <button
        type="button"
        disabled={encryptedName.length < 16 || selectedIds.length === 0}
        onClick={() => void create()}
      >
        Create album
      </button>
      <span role="status">{status}</span>
    </details>
  );
}
