"use client";

import { useState } from "react";

export function UploadController() {
  const [status, setStatus] = useState("No uploads queued.");
  return (
    <label>
      <span style={{ display: "inline-block", padding: "7px 12px", border: "1px solid var(--border)" }}>
        Add photos
      </span>
      <input
        type="file"
        multiple
        accept="image/*,video/*"
        style={{ display: "none" }}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          const accepted = files.filter(
            (file) =>
              file.type.startsWith("image/") ||
              file.type.startsWith("video/"),
          );
          setStatus(
            accepted.length === files.length
              ? `${accepted.length} media files ready for encrypted upload.`
              : "Photos accepts only image and video media.",
          );
        }}
      />
      <span role="status" style={{ marginLeft: 10, color: "var(--muted-foreground)" }}>{status}</span>
    </label>
  );
}
