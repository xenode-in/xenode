"use client";

import { useState } from "react";

export function ShareDialog({ selectedIds }: { selectedIds: string[] }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"viewer" | "commenter" | "editor">("viewer");
  return (
    <>
      <button type="button" disabled={!selectedIds.length} onClick={() => setOpen(true)}>
        Share ({selectedIds.length})
      </button>
      {open ? (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: "25% 30%", zIndex: 40, background: "var(--card)", padding: 24, border: "1px solid var(--muted-foreground)" }}>
          <h2>Share selected assets</h2>
          <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
            <option value="viewer">Viewer</option>
            <option value="commenter">Commenter</option>
            <option value="editor">Editor</option>
          </select>
          <p>Server enforcement will use the selected access role: {role}.</p>
          <button type="button" onClick={() => setOpen(false)}>Close</button>
        </div>
      ) : null}
    </>
  );
}
