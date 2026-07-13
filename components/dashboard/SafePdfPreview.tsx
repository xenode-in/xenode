"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SafePdfPreviewProps {
  blob: Blob;
  maxPages: number;
  maxPixelsPerPage: number;
}

export function SafePdfPreview({
  blob,
  maxPages,
  maxPixelsPerPage,
}: SafePdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(
    null,
  );
  const renderRef = useRef<import("pdfjs-dist").RenderTask | null>(null);
  const loadingTaskRef = useRef<
    import("pdfjs-dist").PDFDocumentLoadingTask | null
  >(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const renderPage = useCallback(async () => {
    const document = documentRef.current;
    const canvas = canvasRef.current;
    if (!document || !canvas) return;

    renderRef.current?.cancel();
    const page = await document.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const requestedPixels =
      baseViewport.width * scale * baseViewport.height * scale;
    const safeScale =
      requestedPixels > maxPixelsPerPage
        ? Math.sqrt(
            maxPixelsPerPage / (baseViewport.width * baseViewport.height),
          )
        : scale;
    const viewport = page.getViewport({ scale: safeScale });
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas rendering is unavailable");

    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const task = page.render({
      canvas,
      canvasContext: context,
      viewport,
      intent: "display",
      annotationMode: 0,
    });
    renderRef.current = task;
    await task.promise;
  }, [maxPixelsPerPage, pageNumber, scale]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError("");
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const task = pdfjs.getDocument({
          data: bytes,
          enableXfa: false,
          maxImageSize: maxPixelsPerPage,
          useWorkerFetch: false,
          stopAtErrors: true,
        });
        const document = await task.promise;
        loadingTaskRef.current = task;
        if (cancelled) {
          await task.destroy();
          return;
        }
        if (document.numPages > maxPages) {
          await task.destroy();
          throw new Error(`PDF exceeds the ${maxPages}-page preview limit`);
        }
        documentRef.current = document;
        setPageCount(document.numPages);
        setPageNumber(1);
      } catch (reason) {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to render this PDF",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      renderRef.current?.cancel();
      documentRef.current = null;
      void loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
    };
  }, [blob, maxPages, maxPixelsPerPage]);

  useEffect(() => {
    if (!pageCount) return;
    void renderPage().catch((reason: unknown) => {
      if (
        reason instanceof Error &&
        reason.name !== "RenderingCancelledException"
      ) {
        setError(reason.message);
      }
    });
  }, [pageCount, renderPage]);

  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <div className="flex h-11 shrink-0 items-center justify-center gap-2 border-b border-white/10 bg-black/40">
        <Button
          variant="ghost"
          size="icon"
          disabled={pageNumber <= 1}
          onClick={() => setPageNumber((page) => page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-24 text-center text-xs text-white/80">
          {pageCount ? `${pageNumber} / ${pageCount}` : "Loading PDF"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          disabled={pageNumber >= pageCount}
          onClick={() => setPageNumber((page) => page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setScale((value) => Math.max(0.5, value - 0.25))}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setScale((value) => Math.min(3, value + 0.25))}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="relative flex-1 overflow-auto p-4">
        {loading && (
          <Loader2 className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 animate-spin text-white" />
        )}
        <canvas ref={canvasRef} className="mx-auto block bg-white shadow-xl" />
      </div>
    </div>
  );
}
