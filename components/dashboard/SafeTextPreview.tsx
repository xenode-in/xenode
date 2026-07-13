"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_LINE_LENGTH = 64 * 1024;
const MAX_LINES = 100_000;

export function SafeTextPreview({ blob }: { blob: Blob }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      const limited = blob.slice(0, MAX_TEXT_BYTES);
      const bytes = new Uint8Array(await limited.arrayBuffer());
      const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      const lines = decoded.split(/\r?\n/, MAX_LINES + 1);
      const clipped = lines
        .slice(0, MAX_LINES)
        .map((line) =>
          line.length > MAX_LINE_LENGTH
            ? `${line.slice(0, MAX_LINE_LENGTH)}?`
            : line,
        )
        .join("\n");

      if (!cancelled) {
        setText(clipped);
        setTruncated(
          blob.size > MAX_TEXT_BYTES ||
            lines.length > MAX_LINES ||
            lines.some((line) => line.length > MAX_LINE_LENGTH),
        );
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [blob]);

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-background p-4 sm:p-6">
      {truncated && (
        <p className="mb-3 text-xs text-muted-foreground">
          Preview capped for safety. Download the file to see all content.
        </p>
      )}
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
        {text}
      </pre>
    </div>
  );
}
