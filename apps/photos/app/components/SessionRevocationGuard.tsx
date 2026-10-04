"use client";

import { useEffect } from "react";
import { io } from "socket.io-client";
import { realtimeTicketAuth } from "@xenode/realtime";

async function fetchRealtimeTicket(): Promise<string> {
  const response = await fetch("/api/realtime/token", {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Realtime ticket unavailable");
  const value = (await response.json()) as { token?: unknown };
  if (typeof value.token !== "string") throw new Error("Malformed ticket");
  return value.token;
}

export function SessionRevocationGuard({
  sessionId,
}: {
  sessionId: string;
}) {
  useEffect(() => {
    let disposed = false;
    let revoked = false;
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("xenode-auth:photos");
    const revoke = () => {
      if (disposed || revoked) return;
      revoked = true;
      channel?.postMessage({ type: "logout" });
      window.location.reload();
    };
    const probe = async () => {
      const response = await fetch("/api/session", {
        credentials: "include",
        cache: "no-store",
      }).catch(() => null);
      if (!response || response.status === 401) revoke();
    };
    const onFocus = () => void probe();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void probe();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    const realtimeOrigin =
      process.env.NEXT_PUBLIC_REALTIME_ORIGIN ??
      (process.env.NODE_ENV === "production"
        ? "https://drive.xenode.in"
        : "http://localhost:3000");
    // Each connection attempt, including reconnects, spends a fresh one-use
    // ticket; tickets authenticate the socket, so no cookies are sent.
    const socket = io(realtimeOrigin, {
      path: "/api/socket.io",
      transports: ["websocket"],
      withCredentials: false,
      auth: realtimeTicketAuth(fetchRealtimeTicket),
    });
    socket.on("sync:event", (event: { type?: string; sessionId?: string }) => {
      if (event.type === "SESSION_REVOKED" && event.sessionId === sessionId) {
        revoke();
      }
    });
    // The server disconnects at session expiry and periodically to
    // re-authorize; Socket.IO does not reconnect those by itself.
    socket.on("disconnect", (reason) => {
      if (reason !== "io server disconnect") return;
      void probe().then(() => {
        if (!disposed && !revoked) socket.connect();
      });
    });
    return () => {
      disposed = true;
      socket.disconnect();
      channel?.close();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sessionId]);
  return null;
}
