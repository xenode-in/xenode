"use client";

import React, { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { Loader2, AlertCircle } from "lucide-react";

interface DocxViewerProps {
  url: string; // Blob URL
  name?: string;
}

/**
 * DocxViewer renders .docx files locally in the browser using the docx-preview library.
 * This ensures high fidelity and privacy as no data is sent to external cloud viewers.
 */
export default function DocxViewer({ url, name }: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderDocx() {
      if (!url || !containerRef.current) return;

      try {
        setLoading(true);
        setError(null);

        // Fetch the blob data
        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to fetch document data");
        const arrayBuffer = await response.arrayBuffer();

        if (cancelled) return;

        // Clear previous content
        if (containerRef.current) {
          containerRef.current.innerHTML = "";
        }

        // Render the document
        await renderAsync(arrayBuffer, containerRef.current, undefined, {
          className: "docx-rendered-content",
          inWrapper: true,
          ignoreHeight: false,
          ignoreWidth: false,
          ignoreLastRenderedPageBreak: false,
          experimental: true,
          trimXmlDeclaration: true,
          useBase64URL: true,
        });

        if (!cancelled) {
          setLoading(false);
          console.log(
            `[DocxViewer] Successfully rendered: ${name || "document"}`,
          );
        }
      } catch (err) {
        console.error("[DocxViewer] Rendering error:", err);
        if (!cancelled) {
          setError(
            "Failed to render document. Please try downloading it instead.",
          );
          setLoading(false);
        }
      }
    }

    renderDocx();

    return () => {
      cancelled = true;
    };
  }, [url, name]);

  return (
    <div className="relative h-full w-full overflow-auto bg-muted/30">
      {loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/50 backdrop-blur-sm">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
          <p className="text-xs font-medium text-muted-foreground">
            Rendering document...
          </p>
        </div>
      )}

      {error && (
        <div className="flex h-full flex-col items-center justify-center p-6 text-center">
          <AlertCircle className="h-10 w-10 text-destructive mb-3" />
          <p className="text-sm font-medium text-destructive">{error}</p>
        </div>
      )}

      <div
        ref={containerRef}
        className="docx-viewer-container min-h-full p-2 sm:p-4 md:p-8"
        style={{
          display: loading || error ? "none" : "block",
          backgroundColor: "#fff",
          boxShadow:
            "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
          margin: "0 auto",
          maxWidth: "900px",
        }}
      />

      {/* Global styles for docx-preview consistency */}
      <style jsx global>{`
        .docx-viewer-container .docx-wrapper {
          background-color: transparent !important;
          padding: 0 !important;
        }
        .docx-viewer-container section.docx {
          margin-bottom: 2rem !important;
          box-shadow:
            0 10px 15px -3px rgb(0 0 0 / 0.1),
            0 4px 6px -4px rgb(0 0 0 / 0.1) !important;
          color: black !important;
        }
        .docx-viewer-container section.docx * {
          color: black !important;
        }
      `}</style>
    </div>
  );
}
