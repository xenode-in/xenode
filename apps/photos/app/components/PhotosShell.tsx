"use client";

import type { ReactNode } from "react";

export function PhotosShell({
  view,
  onView,
  actions,
  children,
}: {
  view: "timeline" | "albums";
  onView(view: "timeline" | "albums"): void;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <main>
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "18px 28px",
          borderBottom: "1px solid #27272a",
        }}
      >
        <strong>Xenode Photos</strong>
        <button type="button" onClick={() => onView("timeline")} disabled={view === "timeline"}>
          Timeline
        </button>
        <button type="button" onClick={() => onView("albums")} disabled={view === "albums"}>
          Albums
        </button>
        <a href="https://xenode.in">Drive</a>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10 }}>{actions}</span>
        <a href="https://accounts.xenode.in">Account</a>
      </nav>
      <div style={{ padding: 28 }}>{children}</div>
    </main>
  );
}
