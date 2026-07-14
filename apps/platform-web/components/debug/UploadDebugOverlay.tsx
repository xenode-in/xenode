"use client";

/**
 * Temporary debug overlay for iOS upload debugging.
 * Shows console logs on-screen so we can diagnose issues on remote devices.
 *
 * Usage: Drop <UploadDebugOverlay /> anywhere in your layout.
 * TODO: Remove this component once iOS upload issues are resolved.
 */

import React, { useEffect, useState, useRef, useCallback } from "react";

interface LogEntry {
  id: number;
  level: "log" | "warn" | "error" | "info";
  message: string;
  timestamp: string;
}

const LEVEL_COLORS: Record<string, string> = {
  log: "#8b8b8b",
  info: "#58a6ff",
  warn: "#d29922",
  error: "#f85149",
};

const LEVEL_BG: Record<string, string> = {
  log: "transparent",
  info: "rgba(56, 139, 253, 0.08)",
  warn: "rgba(210, 153, 34, 0.08)",
  error: "rgba(248, 81, 73, 0.08)",
};

let logIdCounter = 0;

export default function UploadDebugOverlay() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback(
    (level: LogEntry["level"], args: unknown[]) => {
      const message = args
        .map((a) => {
          if (typeof a === "string") return a;
          try {
            return JSON.stringify(a, null, 0);
          } catch {
            return String(a);
          }
        })
        .join(" ");

      const now = new Date();
      const timestamp = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}.${now.getMilliseconds().toString().padStart(3, "0")}`;

      setLogs((prev) => {
        const next = [
          ...prev,
          { id: logIdCounter++, level, message, timestamp },
        ];
        // Keep max 200 entries
        return next.length > 200 ? next.slice(-200) : next;
      });
    },
    [],
  );

  useEffect(() => {
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    const origInfo = console.info;

    console.log = (...args: unknown[]) => {
      origLog.apply(console, args);
      addLog("log", args);
    };
    console.warn = (...args: unknown[]) => {
      origWarn.apply(console, args);
      addLog("warn", args);
    };
    console.error = (...args: unknown[]) => {
      origError.apply(console, args);
      addLog("error", args);
    };
    console.info = (...args: unknown[]) => {
      origInfo.apply(console, args);
      addLog("info", args);
    };

    // Catch unhandled errors too
    const handleError = (e: ErrorEvent) => {
      addLog("error", [`[Uncaught] ${e.message} at ${e.filename}:${e.lineno}`]);
    };
    const handleRejection = (e: PromiseRejectionEvent) => {
      addLog("error", [
        `[Unhandled Rejection] ${e.reason?.message || e.reason}`,
      ]);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
      console.info = origInfo;
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, [addLog]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && isOpen) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isOpen]);

  const filteredLogs = filter
    ? logs.filter((l) =>
        l.message.toLowerCase().includes(filter.toLowerCase()),
      )
    : logs;

  const errorCount = logs.filter((l) => l.level === "error").length;
  const warnCount = logs.filter((l) => l.level === "warn").length;

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        style={{
          position: "fixed",
          bottom: 16,
          left: 16,
          zIndex: 99999,
          width: 48,
          height: 48,
          borderRadius: "50%",
          border: "2px solid rgba(255,255,255,0.15)",
          background: errorCount > 0 ? "#d1242f" : "rgba(30,30,30,0.9)",
          color: "#fff",
          fontSize: 18,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
        title="Toggle debug overlay"
      >
        🐛
        {(errorCount > 0 || warnCount > 0) && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              background: errorCount > 0 ? "#f85149" : "#d29922",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 8,
              padding: "1px 5px",
              minWidth: 16,
              textAlign: "center",
            }}
          >
            {errorCount || warnCount}
          </span>
        )}
      </button>

      {/* Debug panel */}
      {isOpen && (
        <div
          style={{
            position: "fixed",
            bottom: 72,
            left: 16,
            right: 16,
            maxHeight: "50vh",
            zIndex: 99999,
            background: "rgba(13, 17, 23, 0.95)",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            fontFamily:
              'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
            fontSize: 11,
            color: "#e6edf3",
            display: "flex",
            flexDirection: "column",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              flexShrink: 0,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 12 }}>
              🐛 Debug Console
            </span>
            <span
              style={{
                fontSize: 10,
                color: "#8b949e",
                marginLeft: 4,
              }}
            >
              {logs.length} entries
            </span>

            {/* Filter input */}
            <input
              type="text"
              placeholder="Filter..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                marginLeft: "auto",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                padding: "3px 8px",
                color: "#e6edf3",
                fontSize: 11,
                width: 120,
                outline: "none",
                fontFamily: "inherit",
              }}
            />

            {/* Clear button */}
            <button
              onClick={() => setLogs([])}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                color: "#8b949e",
                padding: "3px 8px",
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "inherit",
              }}
            >
              Clear
            </button>

            {/* Copy all button */}
            <button
              onClick={() => {
                const text = logs
                  .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`)
                  .join("\n");
                navigator.clipboard.writeText(text).catch(() => {});
              }}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                color: "#8b949e",
                padding: "3px 8px",
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "inherit",
              }}
            >
              Copy
            </button>
          </div>

          {/* Log entries */}
          <div
            ref={scrollRef}
            style={{
              overflowY: "auto",
              padding: "4px 0",
              flex: 1,
              WebkitOverflowScrolling: "touch",
            }}
          >
            {filteredLogs.length === 0 ? (
              <div
                style={{
                  padding: "16px 12px",
                  color: "#484f58",
                  textAlign: "center",
                }}
              >
                {filter
                  ? "No logs match filter"
                  : "No logs yet. Upload a video to see logs."}
              </div>
            ) : (
              filteredLogs.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    padding: "3px 12px",
                    borderBottom: "1px solid rgba(255,255,255,0.03)",
                    background: LEVEL_BG[entry.level],
                    wordBreak: "break-all",
                    lineHeight: 1.4,
                  }}
                >
                  <span style={{ color: "#484f58", marginRight: 6 }}>
                    {entry.timestamp}
                  </span>
                  <span
                    style={{
                      color: LEVEL_COLORS[entry.level],
                      fontWeight: entry.level === "error" ? 600 : 400,
                    }}
                  >
                    {entry.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
